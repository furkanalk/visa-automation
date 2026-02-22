import type { Kysely } from 'kysely';
import type { Database, HitlTask, NewHitlTask } from '../schema.js';
import type { HitlResolution, HitlTaskStatus, HitlTaskType } from '@visa-automation/shared';

export interface HitlFilters {
  tenantId: string;
  status?: HitlTaskStatus;
  type?: HitlTaskType;
  limit?: number;
  offset?: number;
}

export class HitlRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: string): Promise<HitlTask | undefined> {
    return this.db
      .selectFrom('hitl_tasks')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByIdAndTenant(id: string, tenantId: string): Promise<HitlTask | undefined> {
    return this.db
      .selectFrom('hitl_tasks')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async findWithFilters(filters: HitlFilters): Promise<{ items: HitlTask[]; total: number }> {
    let query = this.db
      .selectFrom('hitl_tasks')
      .selectAll()
      .where('tenant_id', '=', filters.tenantId);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
    }

    if (filters.type) {
      query = query.where('type', '=', filters.type);
    }

    // Get total count
    const countResult = await this.db
      .selectFrom('hitl_tasks')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', filters.tenantId)
      .$if(!!filters.status, (qb) => qb.where('status', '=', filters.status!))
      .$if(!!filters.type, (qb) => qb.where('type', '=', filters.type!))
      .executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    const items = await query
      .orderBy('created_at', 'desc')
      .limit(filters.limit ?? 20)
      .offset(filters.offset ?? 0)
      .execute();

    return { items, total };
  }

  async assign(id: string, _assignedTo: string): Promise<HitlTask | undefined> {
    // Note: assignedTo is not stored in the current schema, only used for audit
    return this.db
      .updateTable('hitl_tasks')
      .set({ status: 'ASSIGNED' })
      .where('id', '=', id)
      .where('status', '=', 'PENDING')
      .returningAll()
      .executeTakeFirst();
  }

  async countPendingByTenant(tenantId: string): Promise<number> {
    const result = await this.db
      .selectFrom('hitl_tasks')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'PENDING')
      .executeTakeFirst();
    return Number(result?.count ?? 0);
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
    resolution: HitlResolution, 
    resolvedBy: string
  ): Promise<HitlTask | undefined> {
    return this.db
      .updateTable('hitl_tasks')
      .set({
        status: 'RESOLVED',
        resolution,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
      })
      .where('id', '=', id)
      .where('status', 'in', ['PENDING', 'ASSIGNED', 'ESCALATED'])
      .returningAll()
      .executeTakeFirst();
  }

  async markExpired(id: string): Promise<HitlTask | undefined> {
    return this.db
      .updateTable('hitl_tasks')
      .set({ status: 'EXPIRED' })
      .where('id', '=', id)
      .where('status', 'in', ['PENDING', 'ASSIGNED'])
      .returningAll()
      .executeTakeFirst();
  }

  async cancel(id: string, cancelledBy?: string): Promise<HitlTask | undefined> {
    return this.db
      .updateTable('hitl_tasks')
      .set({ 
        status: 'CANCELLED',
        resolved_at: new Date(),
        resolved_by: cancelledBy,
      })
      .where('id', '=', id)
      .where('status', 'in', ['PENDING', 'ASSIGNED', 'ESCALATED'])
      .returningAll()
      .executeTakeFirst();
  }

  async escalate(
    id: string,
    reason: string,
    escalatedBy: string
  ): Promise<HitlTask | undefined> {
    return this.db
      .updateTable('hitl_tasks')
      .set({
        status: 'ESCALATED',
        escalation_reason: reason,
        escalated_at: new Date(),
        escalated_by: escalatedBy,
      })
      .where('id', '=', id)
      .where('status', 'in', ['PENDING', 'ASSIGNED'])
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
