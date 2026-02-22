import { sql, type Kysely } from 'kysely';
import type { Database, Job, JobRun, NewJob, JobUpdate } from '../schema.js';

export type JobRunWithAgent = JobRun & { agent_name: string | null };

export interface JobFilters {
  tenantId: string;
  status?: string;
  visaType?: string;
  /** When true, exclude jobs where config.slot_check_only === true (scout/slot-check jobs) */
  excludeSlotCheck?: boolean;
  limit?: number;
  offset?: number;
}

export class JobRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: string): Promise<Job | undefined> {
    return this.db
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByIdAndTenant(id: string, tenantId: string): Promise<Job | undefined> {
    return this.db
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  /**
   * Batch fetch jobs by IDs (for performance)
   * Returns jobs that match both the IDs and tenant
   */
  async findByIds(tenantId: string, ids: string[]): Promise<Job[]> {
    if (ids.length === 0) return [];
    
    return this.db
      .selectFrom('jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', ids)
      .execute();
  }

  async findByTenantId(tenantId: string, limit = 20, offset = 0): Promise<Job[]> {
    return this.db
      .selectFrom('jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  async findWithFilters(filters: JobFilters): Promise<{ items: Job[]; total: number }> {
    const excludeSlotCheckExpr = sql<boolean>`(coalesce(config, '{}'::jsonb)->>'slot_check_only') is distinct from 'true'`;

    let query = this.db
      .selectFrom('jobs')
      .selectAll()
      .where('tenant_id', '=', filters.tenantId);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
    }

    if (filters.visaType) {
      query = query.where('visa_type', '=', filters.visaType);
    }

    if (filters.excludeSlotCheck) {
      query = query.where(excludeSlotCheckExpr);
    }

    // Get total count
    let countQuery = this.db
      .selectFrom('jobs')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', filters.tenantId)
      .$if(!!filters.status, (qb) => qb.where('status', '=', filters.status!))
      .$if(!!filters.visaType, (qb) => qb.where('visa_type', '=', filters.visaType!))
      .$if(!!filters.excludeSlotCheck, (qb) => qb.where(excludeSlotCheckExpr));
    const countResult = await countQuery.executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    const items = await query
      .orderBy('created_at', 'desc')
      .limit(filters.limit ?? 20)
      .offset(filters.offset ?? 0)
      .execute();

    return { items, total };
  }

  async countByTenant(tenantId: string): Promise<number> {
    const result = await this.db
      .selectFrom('jobs')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async create(job: NewJob): Promise<Job> {
    const result = await this.db
      .insertInto('jobs')
      .values({
        ...job,
        // applicant_data ve config doğrudan object olarak yazılır
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    
    return result;
  }

  async update(id: string, updates: JobUpdate): Promise<Job | undefined> {
    const updateData: Record<string, unknown> = { ...updates };
    // applicant_data ve config doğrudan object olarak yazılır
    updateData.updated_at = new Date();

    return this.db
      .updateTable('jobs')
      .set(updateData as JobUpdate)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async updateStatus(id: string, status: string, additionalUpdates?: Partial<JobUpdate>): Promise<Job | undefined> {
    return this.db
      .updateTable('jobs')
      .set({
        status,
        updated_at: new Date(),
        ...additionalUpdates,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Update status only if current status matches (optimistic guard for transitions).
   * Returns updated job or undefined if no row matched.
   */
  async updateStatusIf(
    id: string,
    expectedCurrentStatus: string,
    newStatus: string,
    additionalUpdates?: Partial<JobUpdate>
  ): Promise<Job | undefined> {
    return this.db
      .updateTable('jobs')
      .set({
        status: newStatus,
        updated_at: new Date(),
        ...additionalUpdates,
      })
      .where('id', '=', id)
      .where('status', '=', expectedCurrentStatus)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Atomic claim: only for QUEUED jobs with no valid lock.
   * Sets locked_by and locked_until in one update. Status stays QUEUED until first FSM transition.
   */
  async acquireLock(id: string, workerId: string, durationMs: number): Promise<boolean> {
    const now = new Date();
    const lockUntil = new Date(Date.now() + durationMs);

    const result = await this.db
      .updateTable('jobs')
      .set({
        locked_by: workerId,
        locked_until: lockUntil,
        updated_at: now,
      })
      .where('id', '=', id)
      .where('status', '=', 'QUEUED')
      .where((eb) =>
        eb.or([
          eb('locked_by', 'is', null),
          eb('locked_until', '<', now),
        ])
      )
      .executeTakeFirst();

    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  /**
   * Renew lease for a job held by this worker (e.g. on agent heartbeat).
   */
  async renewLock(id: string, lockedBy: string, durationMs: number): Promise<boolean> {
    const lockUntil = new Date(Date.now() + durationMs);
    const result = await this.db
      .updateTable('jobs')
      .set({
        locked_until: lockUntil,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('locked_by', '=', lockedBy)
      .executeTakeFirst();
    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  async releaseLock(id: string, workerId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('jobs')
      .set({
        locked_by: null,
        locked_until: null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('locked_by', '=', workerId)
      .executeTakeFirst();
    
    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  /** Terminal job statuses; these are never reset by stuck-job recovery. */
  private static readonly TERMINAL_STATUSES = ['COMPLETED', 'FAILED_TERMINAL', 'CANCELLED'] as const;

  /**
   * Reset jobs that have an expired lock (locked_by set, locked_until &lt; now or null).
   * Only non-terminal jobs are reset; they become reclaimable (status QUEUED, lock cleared).
   * Returns the number of jobs reset.
   */
  async resetStuckRunningJobs(): Promise<number> {
    const now = new Date();
    const result = await this.db
      .updateTable('jobs')
      .set({
        status: 'QUEUED',
        locked_by: null,
        locked_until: null,
        updated_at: now,
      })
      .where('locked_by', 'is not', null)
      .where((eb) => eb('locked_until', 'is', null).or('locked_until', '<', now))
      .where('status', 'not in', JobRepository.TERMINAL_STATUSES)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  /**
   * Clear expired lock on QUEUED jobs (worker claimed then died before run started).
   * Status stays QUEUED; job becomes claimable again.
   * Returns the number of jobs reset.
   */
  async clearExpiredLockOnQueuedJobs(): Promise<number> {
    const now = new Date();
    const result = await this.db
      .updateTable('jobs')
      .set({
        locked_by: null,
        locked_until: null,
        updated_at: now,
      })
      .where('status', '=', 'QUEUED')
      .where('locked_by', 'is not', null)
      .where((eb) => eb('locked_until', 'is', null).or('locked_until', '<', now))
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  /**
   * Get job runs for a job (for details UI), with agent name when agent_id is set.
   */
  async findJobRunsByJobId(jobId: string, tenantId: string): Promise<JobRunWithAgent[]> {
    const rows = await this.db
      .selectFrom('job_runs')
      .leftJoin('agents', 'agents.id', 'job_runs.agent_id')
      .select([
        'job_runs.id',
        'job_runs.job_id',
        'job_runs.tenant_id',
        'job_runs.worker_id',
        'job_runs.agent_id',
        'job_runs.attempt_number',
        'job_runs.status',
        'job_runs.started_at',
        'job_runs.finished_at',
        'job_runs.error_code',
        'job_runs.error_message',
        'job_runs.checkpoint_data',
        'agents.name as agent_name',
      ])
      .where('job_runs.job_id', '=', jobId)
      .where('job_runs.tenant_id', '=', tenantId)
      .orderBy('job_runs.started_at', 'desc')
      .execute();
    return rows as JobRunWithAgent[];
  }
}
