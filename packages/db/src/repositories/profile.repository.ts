import type { Kysely } from 'kysely';
import type { Database, AgentProfile, NewAgentProfile, AgentProfileUpdate } from '../schema.js';

export class ProfileRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * Find profile by ID with tenant isolation
   */
  async findById(tenantId: string, id: string): Promise<AgentProfile | undefined> {
    return this.db
      .selectFrom('agent_profiles')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  /**
   * Find all profiles for a tenant
   */
  async findByTenantId(tenantId: string, limit = 100, offset = 0): Promise<AgentProfile[]> {
    return this.db
      .selectFrom('agent_profiles')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  /**
   * Find default profile for a tenant
   */
  async findDefault(tenantId: string): Promise<AgentProfile | undefined> {
    return this.db
      .selectFrom('agent_profiles')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('is_default', '=', true)
      .executeTakeFirst();
  }

  /**
   * Find first scout profile for a tenant (for DP to assign when creating scout agents)
   */
  async findScout(tenantId: string): Promise<AgentProfile | undefined> {
    return this.db
      .selectFrom('agent_profiles')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('is_scout', '=', true)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Find all scout profile IDs for a tenant (for filtering agents by is_scout)
   */
  async findScoutProfileIds(tenantId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('agent_profiles')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('is_scout', '=', true)
      .execute();
    return rows.map((r) => r.id);
  }

  /**
   * Create a new profile
   */
  async create(profile: NewAgentProfile): Promise<AgentProfile> {
    // If this is set as default, unset other defaults first
    if (profile.is_default) {
      await this.db
        .updateTable('agent_profiles')
        .set({ is_default: false, updated_at: new Date() })
        .where('tenant_id', '=', profile.tenant_id)
        .where('is_default', '=', true)
        .execute();
    }

    return this.db
      .insertInto('agent_profiles')
      .values(profile)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Update profile with tenant isolation
   */
  async update(tenantId: string, id: string, updates: AgentProfileUpdate): Promise<AgentProfile | undefined> {
    // If setting as default, unset other defaults first
    if (updates.is_default) {
      await this.db
        .updateTable('agent_profiles')
        .set({ is_default: false, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '!=', id)
        .where('is_default', '=', true)
        .execute();
    }

    return this.db
      .updateTable('agent_profiles')
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
   * Delete profile with tenant isolation
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('agent_profiles')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * Count agents using a profile (tenant-scoped via profile's tenant)
   */
  async countAgentsUsingProfile(tenantId: string, profileId: string): Promise<number> {
    const result = await this.db
      .selectFrom('agents')
      .select(({ fn }) => fn.count<number>('id').as('count'))
      .where('profile_id', '=', profileId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    
    return result?.count ?? 0;
  }
}
