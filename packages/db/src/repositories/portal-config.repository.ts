import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, PortalConfigRow, NewPortalConfig, PortalConfigUpdate } from '../schema.js';

export class PortalConfigRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * Find portal config by ID with tenant isolation
   */
  async findById(tenantId: string, id: string): Promise<PortalConfigRow | undefined> {
    return this.db
      .selectFrom('portal_configs')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  /**
   * Find portal config by portal_id with tenant isolation
   */
  async findByPortalId(tenantId: string, portalId: string): Promise<PortalConfigRow | undefined> {
    return this.db
      .selectFrom('portal_configs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('portal_id', '=', portalId)
      .executeTakeFirst();
  }

  /**
   * Find all portal configs for a tenant
   */
  async findByTenantId(
    tenantId: string,
    options: { enabled?: boolean; limit?: number; offset?: number } = {}
  ): Promise<PortalConfigRow[]> {
    let qb = this.db
      .selectFrom('portal_configs')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (options.enabled !== undefined) {
      qb = qb.where('enabled', '=', options.enabled);
    }

    return qb
      .orderBy('name', 'asc')
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0)
      .execute();
  }

  /**
   * Create a new portal config
   */
  async create(config: NewPortalConfig): Promise<PortalConfigRow> {
    return this.db
      .insertInto('portal_configs')
      .values(config)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Update portal config with tenant isolation
   */
  async update(tenantId: string, id: string, updates: PortalConfigUpdate): Promise<PortalConfigRow | undefined> {
    return this.db
      .updateTable('portal_configs')
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Update portal config by portal_id
   */
  async updateByPortalId(
    tenantId: string,
    portalId: string,
    updates: PortalConfigUpdate
  ): Promise<PortalConfigRow | undefined> {
    return this.db
      .updateTable('portal_configs')
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('portal_id', '=', portalId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Upsert portal config
   */
  async upsert(tenantId: string, portalId: string, config: Partial<NewPortalConfig>): Promise<PortalConfigRow> {
    const existing = await this.findByPortalId(tenantId, portalId);
    
    if (existing) {
      const updated = await this.update(tenantId, existing.id, config);
      return updated!;
    }

    return this.create({
      tenant_id: tenantId,
      portal_id: portalId,
      name: config.name ?? portalId,
      ...config,
    });
  }

  /**
   * Set enabled/disabled with tenant isolation
   */
  async setEnabled(tenantId: string, id: string, enabled: boolean): Promise<PortalConfigRow | undefined> {
    return this.db
      .updateTable('portal_configs')
      .set({
        enabled,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Delete portal config with tenant isolation
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('portal_configs')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * Get agent IDs assigned to a portal
   */
  async getAssignedAgentIds(tenantId: string, portalId: string): Promise<string[]> {
    const agents = await this.db
      .selectFrom('agents')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where(
        sql<boolean>`desired_portals @> ${JSON.stringify([portalId])}::jsonb`
      )
      .execute();
    
    return agents.map(a => a.id);
  }
}
