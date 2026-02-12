import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { Database, AuditLogRow, NewAuditLog } from '../schema.js';
import type { ActorType, ListAuditLogsQuery, AuditLogSummary } from '@visa-automation/shared';

export class AuditRepository {
  constructor(private db: Kysely<Database>) {}

  async findById(id: string): Promise<AuditLogRow | undefined> {
    return this.db
      .selectFrom('audit_logs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByTenantId(tenantId: string, query: ListAuditLogsQuery = {}): Promise<AuditLogRow[]> {
    let qb = this.db
      .selectFrom('audit_logs')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    qb = this.applyFilters(qb, query);

    return qb
      .orderBy('created_at', 'desc')
      .limit(query.limit ?? 100)
      .offset(query.offset ?? 0)
      .execute();
  }

  async findAll(query: ListAuditLogsQuery = {}): Promise<AuditLogRow[]> {
    let qb = this.db
      .selectFrom('audit_logs')
      .selectAll();

    if (query.tenant_id) {
      qb = qb.where('tenant_id', '=', query.tenant_id);
    }

    qb = this.applyFilters(qb, query);

    return qb
      .orderBy('created_at', 'desc')
      .limit(query.limit ?? 100)
      .offset(query.offset ?? 0)
      .execute();
  }

  private applyFilters<T extends SelectQueryBuilder<Database, 'audit_logs', AuditLogRow>>(
    qb: T,
    query: ListAuditLogsQuery
  ): T {
    if (query.actor_type) {
      qb = qb.where('actor_type', '=', query.actor_type) as T;
    }

    if (query.actor_id) {
      qb = qb.where('actor_id', '=', query.actor_id) as T;
    }

    if (query.action) {
      const actions = Array.isArray(query.action) ? query.action : [query.action];
      qb = qb.where('action', 'in', actions) as T;
    }

    if (query.resource_type) {
      qb = qb.where('resource_type', '=', query.resource_type) as T;
    }

    if (query.resource_id) {
      qb = qb.where('resource_id', '=', query.resource_id) as T;
    }

    if (query.from) {
      qb = qb.where('created_at', '>=', query.from) as T;
    }

    if (query.to) {
      qb = qb.where('created_at', '<=', query.to) as T;
    }

    return qb;
  }

  async create(log: NewAuditLog): Promise<AuditLogRow> {
    return this.db
      .insertInto('audit_logs')
      .values(log)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createMany(logs: NewAuditLog[]): Promise<AuditLogRow[]> {
    if (logs.length === 0) return [];
    
    return this.db
      .insertInto('audit_logs')
      .values(logs)
      .returningAll()
      .execute();
  }

  async getSummary(tenantId: string, from?: Date, to?: Date): Promise<AuditLogSummary> {
    let baseQb = this.db
      .selectFrom('audit_logs')
      .where('tenant_id', '=', tenantId);

    if (from) {
      baseQb = baseQb.where('created_at', '>=', from);
    }
    if (to) {
      baseQb = baseQb.where('created_at', '<=', to);
    }

    // Get total count
    const totalResult = await baseQb
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .executeTakeFirst();

    // Get counts by action
    const byAction = await baseQb
      .select([
        'action',
        ({ fn }) => fn.count<number>('id').as('count'),
      ])
      .groupBy('action')
      .execute();

    // Get counts by resource_type
    const byResourceType = await baseQb
      .select([
        'resource_type',
        ({ fn }) => fn.count<number>('id').as('count'),
      ])
      .groupBy('resource_type')
      .execute();

    // Get counts by actor_type
    const byActorType = await baseQb
      .select([
        'actor_type',
        ({ fn }) => fn.count<number>('id').as('count'),
      ])
      .groupBy('actor_type')
      .execute();

    return {
      total_count: totalResult?.count ?? 0,
      by_action: Object.fromEntries(byAction.map(r => [r.action, r.count])),
      by_resource_type: Object.fromEntries(byResourceType.map(r => [r.resource_type, r.count])),
      by_actor_type: Object.fromEntries(byActorType.map(r => [r.actor_type, r.count])) as Record<ActorType, number>,
    };
  }

  async deleteOlderThan(olderThan: Date, tenantId?: string): Promise<number> {
    let qb = this.db
      .deleteFrom('audit_logs')
      .where('created_at', '<', olderThan);

    if (tenantId) {
      qb = qb.where('tenant_id', '=', tenantId);
    }

    const result = await qb.executeTakeFirst();
    return Number(result.numDeletedRows ?? 0n);
  }
}
