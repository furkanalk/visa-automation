import { db, JobRepository } from '@visa-automation/db';
import { enqueueJob } from '../queue/producer.js';
import { DEFAULTS, JOB_STATES } from '@visa-automation/shared';
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobStatusResponse,
  JobQueuePayload,
} from '@visa-automation/shared';

export class JobService {
  private jobRepo: JobRepository;

  constructor() {
    this.jobRepo = new JobRepository(db.instance);
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
}
