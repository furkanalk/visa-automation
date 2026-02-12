import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, Agent, NewAgent, AgentUpdate } from '../schema.js';
import type { AgentStatus, ListAgentsQuery, BulkAgentSelector } from '@visa-automation/shared';

export class AgentRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * Find agent by ID with tenant isolation
   */
  async findById(tenantId: string, id: string): Promise<Agent | undefined> {
    return this.db
      .selectFrom('agents')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  /**
   * Find agents by tenant with optional filters
   */
  async findByTenantId(tenantId: string, query: ListAgentsQuery = {}): Promise<Agent[]> {
    let qb = this.db
      .selectFrom('agents')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      qb = qb.where('status', 'in', statuses);
    }

    if (query.mode) {
      qb = qb.where('mode', '=', query.mode);
    }

    if (query.profile_id) {
      qb = qb.where('profile_id', '=', query.profile_id);
    }

    // Filter by portal_id (agents assigned to specific portal)
    if (query.portal_id) {
      qb = qb.where(
        sql<boolean>`desired_portals @> ${JSON.stringify([query.portal_id])}::jsonb`
      );
    }

    return qb
      .orderBy('created_at', 'desc')
      .limit(query.limit ?? 100)
      .offset(query.offset ?? 0)
      .execute();
  }

  /**
   * Find agents assigned to a specific portal
   */
  async findByPortalId(tenantId: string, portalId: string): Promise<Agent[]> {
    return this.db
      .selectFrom('agents')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where(
        sql<boolean>`desired_portals @> ${JSON.stringify([portalId])}::jsonb`
      )
      .execute();
  }

  /**
   * Create a new agent
   */
  async create(agent: NewAgent): Promise<Agent> {
    return this.db
      .insertInto('agents')
      .values(agent)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Update agent with tenant isolation
   */
  async update(tenantId: string, id: string, updates: AgentUpdate): Promise<Agent | undefined> {
    return this.db
      .updateTable('agents')
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
   * Update agent status with tenant isolation
   */
  async updateStatus(tenantId: string, id: string, status: AgentStatus): Promise<Agent | undefined> {
    return this.db
      .updateTable('agents')
      .set({
        status,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Update agent heartbeat with tenant isolation
   */
  async updateHeartbeat(
    tenantId: string,
    id: string,
    status: AgentStatus,
    currentJobId?: string,
    metadata?: Record<string, unknown>
  ): Promise<Agent | undefined> {
    const updates: AgentUpdate = {
      status,
      last_heartbeat_at: new Date(),
      current_job_id: currentJobId ?? null,
    };
    
    if (metadata) {
      updates.metadata = metadata;
    }

    return this.db
      .updateTable('agents')
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
   * Assign profile to agent with tenant isolation
   */
  async assignProfile(tenantId: string, id: string, profileId: string | null): Promise<Agent | undefined> {
    return this.db
      .updateTable('agents')
      .set({
        profile_id: profileId,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Assign portals to agent with tenant isolation
   */
  async assignPortals(tenantId: string, id: string, portalIds: string[]): Promise<Agent | undefined> {
    return this.db
      .updateTable('agents')
      .set({
        desired_portals: portalIds,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Bulk assign profile to multiple agents (tenant-scoped)
   */
  async bulkAssignProfile(
    tenantId: string,
    profileId: string,
    selector: BulkAgentSelector
  ): Promise<string[]> {
    // First, get matching agent IDs
    let qb = this.db
      .selectFrom('agents')
      .select('id')
      .where('tenant_id', '=', tenantId);

    // Apply filters
    if (selector.filters?.mode) {
      qb = qb.where('mode', '=', selector.filters.mode);
    }
    if (selector.filters?.status && selector.filters.status.length > 0) {
      qb = qb.where('status', 'in', selector.filters.status);
    }

    // Apply strategy
    if (selector.strategy === 'COUNT' && selector.value) {
      qb = qb.limit(selector.value);
    } else if (selector.strategy === 'PERCENT' && selector.value) {
      // Get count first for percentage calculation
      const countResult = await this.db
        .selectFrom('agents')
        .select(({ fn }) => fn.count<number>('id').as('count'))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      
      const totalCount = countResult?.count ?? 0;
      const limit = Math.ceil(totalCount * (selector.value / 100));
      qb = qb.limit(limit);
    }

    const agents = await qb.execute();
    const agentIds = agents.map(a => a.id);

    if (agentIds.length === 0) {
      return [];
    }

    // Update all matching agents (already tenant-filtered via agentIds)
    await this.db
      .updateTable('agents')
      .set({
        profile_id: profileId,
        updated_at: new Date(),
      })
      .where('id', 'in', agentIds)
      .where('tenant_id', '=', tenantId) // Extra safety
      .execute();

    return agentIds;
  }

  /**
   * Count agents by mode for a tenant
   */
  async countByTenant(tenantId: string): Promise<{ async: number; sync: number; total: number }> {
    const results = await this.db
      .selectFrom('agents')
      .select([
        'mode',
        ({ fn }) => fn.count<number>('id').as('count'),
      ])
      .where('tenant_id', '=', tenantId)
      .groupBy('mode')
      .execute();

    let asyncCount = 0;
    let syncCount = 0;

    for (const row of results) {
      if (row.mode === 'ASYNC') asyncCount = row.count;
      if (row.mode === 'SYNC') syncCount = row.count;
    }

    return {
      async: asyncCount,
      sync: syncCount,
      total: asyncCount + syncCount,
    };
  }

  /**
   * Delete agent with tenant isolation
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('agents')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * Find stale agents (no heartbeat within threshold)
   */
  async findStaleAgents(tenantId: string, staleSinceMs: number): Promise<Agent[]> {
    const staleThreshold = new Date(Date.now() - staleSinceMs);
    
    return this.db
      .selectFrom('agents')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'ONLINE')
      .where('last_heartbeat_at', '<', staleThreshold)
      .execute();
  }
}
