import { getDb, JobRepository, JobEventRepository, TenantRepository, SystemSettingsRepository } from '@visa-automation/db';
import { enqueueJob } from '../queue/producer.js';
import { JOB_STATES } from '@visa-automation/shared';
import type {
  CreateJobRequest,
  CreateJobResponse,
  JobStatusResponse,
  JobQueuePayload,
} from '@visa-automation/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Job service for public API: create job, get status, list, and token-based actions (stop/ack).
 * Used by /api/jobs routes.
 */
export class JobService {
  private jobRepo: JobRepository;
  private eventRepo: JobEventRepository;
  private tenantRepo: TenantRepository;
  private settingsRepo: SystemSettingsRepository;

  constructor() {
    const db = getDb();
    this.jobRepo = new JobRepository(db);
    this.eventRepo = new JobEventRepository(db);
    this.tenantRepo = new TenantRepository(db);
    this.settingsRepo = new SystemSettingsRepository(db);
  }

  /** Resolve tenant_id: if not a UUID, look up by slug and return tenant id. */
  async resolveTenantId(tenantIdOrSlug: string): Promise<string> {
    if (UUID_REGEX.test(tenantIdOrSlug)) return tenantIdOrSlug;
    const tenant = await this.tenantRepo.findBySlug(tenantIdOrSlug);
    if (!tenant) throw new Error(`Tenant not found: ${tenantIdOrSlug}`);
    return tenant.id;
  }

  async createJob(request: CreateJobRequest): Promise<CreateJobResponse> {
    const tenant_id = await this.resolveTenantId(request.tenant_id);
    const defaultPriority = await this.settingsRepo.getNumber(null, 'job', 'default_priority', 50);
    const maxRetries = await this.settingsRepo.getNumber(null, 'job', 'max_retries', 3);
    const job = await this.jobRepo.create({
      tenant_id,
      external_ref: request.external_ref ?? null,
      visa_type: request.visa_type,
      status: JOB_STATES.QUEUED,
      priority: request.priority ?? defaultPriority,
      applicant_data: request.applicant,
      config: request.config ?? {},
      retry_count: 0,
      max_retries: maxRetries,
    });

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
    if (!job) return null;

    return {
      job_id: job.id,
      tenant_id: job.tenant_id,
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

  async listJobs(tenantIdOrSlug: string, limit: number, offset: number): Promise<JobStatusResponse[]> {
    const tenantId = await this.resolveTenantId(tenantIdOrSlug);
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

  async cancelJobByToken(jobId: string): Promise<void> {
    const job = await this.jobRepo.findById(jobId);
    if (!job) return;

    await this.jobRepo.updateStatus(jobId, JOB_STATES.CANCELLED);
    await this.eventRepo.createStateTransition(
      jobId,
      job.tenant_id,
      job.status,
      JOB_STATES.CANCELLED,
      { reason: 'Stopped via Telegram action', channel: 'telegram' }
    );
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
