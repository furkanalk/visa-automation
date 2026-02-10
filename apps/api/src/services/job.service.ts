import { db, JobRepository, JobEventRepository } from '@visa-automation/db';
import { enqueueJob } from '../queue/producer.js';
import { DEFAULTS, JOB_STATES, isTerminalState } from '@visa-automation/shared';
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobStatusResponse,
  JobQueuePayload,
} from '@visa-automation/shared';

export class JobService {
  private jobRepo: JobRepository;
  private eventRepo: JobEventRepository;

  constructor() {
    this.jobRepo = new JobRepository(db.instance);
    this.eventRepo = new JobEventRepository(db.instance);
  }

  async createJob(request: CreateJobRequest): Promise<CreateJobResponse> {
    // Create job in database
    const job = await this.jobRepo.create({
      tenant_id: request.tenant_id,
      external_ref: request.external_ref ?? null,
      visa_type: request.visa_type,
      status: JOB_STATES.QUEUED,
      priority: request.priority ?? DEFAULTS.JOB_PRIORITY,
      applicant_data: request.applicant,
      config: request.config ?? {},
      retry_count: 0,
      max_retries: DEFAULTS.MAX_RETRIES,
    });

    // Enqueue for processing
    const queuePayload: JobQueuePayload = {
      job_id: job.id,
      tenant_id: job.tenant_id,
      visa_type: request.visa_type,
      priority: job.priority,
      applicant_data: request.applicant,
      config: request.config ?? {},
      portal_id: request.portal_id,
      attempt_number: 1,
    };

    await enqueueJob(queuePayload);

    return {
      job_id: job.id,
      status: JOB_STATES.QUEUED,
      message: 'Job created and queued for processing',
    };
  }

  async getJob(id: string): Promise<(JobStatusResponse & { tenant_id: string }) | null> {
    const job = await this.jobRepo.findById(id);

    if (!job) {
      return null;
    }

    return {
      job_id: job.id,
      tenant_id: job.tenant_id, // Include tenant_id for authorization check
      status: job.status as JobStatusResponse['status'],
      priority: job.priority,
      retry_count: job.retry_count,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at ?? undefined,
      hitl_pending: job.status === JOB_STATES.WAITING_HITL,
      current_step: job.status,
    };
  }

  async listJobs(tenantId: string, limit: number, offset: number): Promise<JobStatusResponse[]> {
    const jobs = await this.jobRepo.findByTenantId(tenantId, limit, offset);

    return jobs.map((job) => ({
      job_id: job.id,
      status: job.status as JobStatusResponse['status'],
      priority: job.priority,
      retry_count: job.retry_count,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at ?? undefined,
      hitl_pending: job.status === JOB_STATES.WAITING_HITL,
      current_step: job.status,
    }));
  }

  async ackJobEvent(args: { jobId: string; tenantId: string; event: string }): Promise<void> {
    const job = await this.jobRepo.findById(args.jobId);
    if (!job) return;
    if (job.tenant_id !== args.tenantId) return;

    await this.eventRepo.create({
      job_id: args.jobId,
      tenant_id: args.tenantId,
      event_type: 'ACK',
      payload: { event: args.event },
    });
  }

  async cancelJob(args: { jobId: string; tenantId: string }): Promise<
    | { ok: true }
    | { ok: false; statusCode: number; message: string; code: string }
  > {
    const job = await this.jobRepo.findById(args.jobId);
    if (!job) {
      return { ok: false, statusCode: 404, message: 'Job not found', code: 'JOB_NOT_FOUND' };
    }
    if (job.tenant_id !== args.tenantId) {
      return { ok: false, statusCode: 403, message: 'Access denied', code: 'FORBIDDEN' };
    }
    if (isTerminalState(job.status as any)) {
      return { ok: false, statusCode: 409, message: 'Job already terminal', code: 'JOB_ALREADY_COMPLETED' };
    }

    await this.jobRepo.updateStatus(args.jobId, JOB_STATES.CANCELLED);
    await this.eventRepo.createStateTransition(
      args.jobId,
      args.tenantId,
      job.status,
      JOB_STATES.CANCELLED,
      { reason: 'Stopped by operator' }
    );

    return { ok: true };
  }

  async cancelJobByToken(jobId: string): Promise<void> {
    const job = await this.jobRepo.findById(jobId);
    if (!job) return;

    await this.jobRepo.updateStatus(jobId, JOB_STATES.CANCELLED);
    await this.eventRepo.createStateTransition(jobId, job.tenant_id, job.status, JOB_STATES.CANCELLED, {
      reason: 'Stopped via Telegram action',
      channel: 'telegram',
    });
  }

  async ackJobEventByToken(jobId: string, event: string): Promise<void> {
    const job = await this.jobRepo.findById(jobId);
    if (!job) return;

    await this.eventRepo.create({
      job_id: jobId,
      tenant_id: job.tenant_id,
      event_type: 'ACK',
      payload: { event, channel: 'telegram' },
    });
  }
}
