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
   * Returns from_state and to_state. When to_state is WAITING_HITL, resume from from_state (e.g. SLOT_SEARCHING).
   */
  async findLatestStateForJob(jobId: string): Promise<{ from_state: string; to_state: string } | null> {
    const row = await this.db
      .selectFrom('job_events')
      .select(['payload'])
      .where('job_id', '=', jobId)
      .where('event_type', '=', 'STATE_TRANSITION')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row?.payload || typeof row.payload !== 'object') return null;
    const p = row.payload as Record<string, unknown>;
    const toState = p.to_state;
    const fromState = p.from_state;
    if (typeof toState !== 'string') return null;
    return { from_state: typeof fromState === 'string' ? fromState : toState, to_state: toState };
  }

  /**
   * Most recent STATE_TRANSITION where to_state equals the given value (e.g. WAITING_HITL).
   * Used to get the state we were in before a transition (e.g. SLOT_SEARCHING before WAITING_HITL).
   */
  async findLatestTransitionToState(
    jobId: string,
    toState: string
  ): Promise<{ from_state: string; to_state: string } | null> {
    const rows = await this.db
      .selectFrom('job_events')
      .select(['payload'])
      .where('job_id', '=', jobId)
      .where('event_type', '=', 'STATE_TRANSITION')
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute();
    for (const row of rows) {
      if (!row?.payload || typeof row.payload !== 'object') continue;
      const p = row.payload as Record<string, unknown>;
      if (p.to_state !== toState) continue;
      const from = p.from_state;
      const to = p.to_state;
      if (typeof to !== 'string') continue;
      return { from_state: typeof from === 'string' ? from : to, to_state: to };
    }
    return null;
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
