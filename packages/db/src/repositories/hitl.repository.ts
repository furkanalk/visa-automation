import type { Kysely } from 'kysely';
import type { Database, HitlTask, NewHitlTask } from '../schema.js';

export class HitlRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: string): Promise<HitlTask | undefined> {
    return this.db
      .selectFrom('hitl_tasks')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByJobId(jobId: string): Promise<HitlTask[]> {
    return this.db
      .selectFrom('hitl_tasks')
      .selectAll()
      .where('job_id', '=', jobId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async findPendingByJobId(jobId: string): Promise<HitlTask | undefined> {
    return this.db
      .selectFrom('hitl_tasks')
      .selectAll()
      .where('job_id', '=', jobId)
      .where('status', '=', 'PENDING')
      .executeTakeFirst();
  }

  async create(task: NewHitlTask): Promise<HitlTask> {
    return this.db
      .insertInto('hitl_tasks')
      .values(task)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async resolve(
    id: string, 
    resolution: Record<string, unknown>, 
    resolvedBy: string
  ): Promise<HitlTask | undefined> {
    return this.db
      .updateTable('hitl_tasks')
      .set({
        status: 'RESOLVED',
        resolution: resolution,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
      })
      .where('id', '=', id)
      .where('status', '=', 'PENDING')
      .returningAll()
      .executeTakeFirst();
  }

  async markExpired(id: string): Promise<HitlTask | undefined> {
    return this.db
      .updateTable('hitl_tasks')
      .set({ status: 'EXPIRED' })
      .where('id', '=', id)
      .where('status', '=', 'PENDING')
      .returningAll()
      .executeTakeFirst();
  }

  async findExpired(): Promise<HitlTask[]> {
    return this.db
      .selectFrom('hitl_tasks')
      .selectAll()
      .where('status', '=', 'PENDING')
      .where('expires_at', '<', new Date())
      .execute();
  }
}
