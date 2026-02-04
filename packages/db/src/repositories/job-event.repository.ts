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

  async createStateTransition(
    jobId: string,
    tenantId: string,
    fromState: string,
    toState: string,
    metadata?: Record<string, unknown>
  ): Promise<JobEvent> {
    return this.create({
      job_id: jobId,
      tenant_id: tenantId,
      event_type: 'STATE_TRANSITION',
      payload: {
        from_state: fromState,
        to_state: toState,
        ...metadata,
      },
    });
  }
}
