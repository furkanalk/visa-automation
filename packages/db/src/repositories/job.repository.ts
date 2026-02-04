import type { Kysely } from 'kysely';
import type { Database, Job, NewJob, JobUpdate } from '../schema.js';

export class JobRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: string): Promise<Job | undefined> {
    return this.db
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
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

  async acquireLock(id: string, workerId: string, durationMs: number): Promise<boolean> {
    const lockUntil = new Date(Date.now() + durationMs);
    
    const result = await this.db
      .updateTable('jobs')
      .set({
        locked_by: workerId,
        locked_until: lockUntil,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where((eb) =>
        eb.or([
          eb('locked_by', 'is', null),
          eb('locked_until', '<', new Date()),
        ])
      )
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
}
