import type { Kysely } from 'kysely';
import type { Database, JobEvent, NewJobEvent } from '../schema.js';

export class JobEventRepository {
  constructor(private db: Kysely<Database>) {}

  async create(event: NewJobEvent): Promise<JobEvent> {
    return this.db
      .insertInto('job_events')
      .values(event)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findByJobId(jobId: string, limit = 50): Promise<JobEvent[]> {
    return this.db
      .selectFrom('job_events')
      .selectAll()
      .where('job_id', '=', jobId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Last STATE_TRANSITION for this job (any run) to resume FSM from checkpoint.
   * Returns the to_state of the most recent transition, or null if none.
   */
  async findLatestStateForJob(jobId: string): Promise<{ to_state: string } | null> {
    const row = await this.db
      .selectFrom('job_events')
      .select(['payload'])
      .where('job_id', '=', jobId)
      .where('event_type', '=', 'STATE_TRANSITION')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row?.payload || typeof row.payload !== 'object') return null;
    const toState = (row.payload as Record<string, unknown>).to_state;
    return typeof toState === 'string' ? { to_state: toState } : null;
  }

  async createStateTransition(
    jobId: string,
    tenantId: string,
    fromState: string,
    toState: string,
    metadata?: Record<string, unknown>,
    jobRunId?: string | null
  ): Promise<JobEvent> {
    return this.create({
      job_id: jobId,
      tenant_id: tenantId,
      job_run_id: jobRunId ?? null,
      event_type: 'STATE_TRANSITION',
      payload: {
        from_state: fromState,
        to_state: toState,
        ...metadata,
      },
    });
  }
}
