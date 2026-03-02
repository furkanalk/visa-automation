import { sql, type Kysely } from 'kysely';
import type {
  Database,
  StaffMember,
  NewStaffMember,
  StaffMemberUpdate,
  StaffActivityLog,
  NewStaffActivityLog,
  StaffSession,
  NewStaffSession,
  StaffStatus,
  StaffRole,
  StaffMetrics,
} from '../schema.js';

export class StaffRepository {
  constructor(private db: Kysely<Database>) {}

  // =====================
  // Staff Member CRUD
  // =====================

  async findById(tenantId: string, id: string): Promise<StaffMember | undefined> {
    return this.db
      .selectFrom('staff_members')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByEmail(tenantId: string, email: string): Promise<StaffMember | undefined> {
    return this.db
      .selectFrom('staff_members')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email', '=', email)
      .executeTakeFirst();
  }

  async findByInviteToken(token: string): Promise<StaffMember | undefined> {
    const staff = await this.db
      .selectFrom('staff_members')
      .selectAll()
      .where('invite_token', '=', token)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (!staff?.invite_token_expires_at) return staff;
    if (new Date(staff.invite_token_expires_at) < new Date()) return undefined;
    return staff;
  }

  async list(
    tenantId: string,
    filters?: {
      status?: StaffStatus;
      role?: StaffRole;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ items: StaffMember[]; total: number }> {
    let query = this.db
      .selectFrom('staff_members')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.status) {
      query = query.where('status', '=', filters.status);
    }

    if (filters?.role) {
      query = query.where('role', '=', filters.role);
    }

    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('name', 'ilike', searchTerm),
          eb('email', 'ilike', searchTerm),
        ])
      );
    }

    // Count total
    const countResult = await this.db
      .selectFrom('staff_members')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const total = Number(countResult?.count ?? 0);

    // Fetch with pagination
    const items = await query
      .orderBy('created_at', 'desc')
      .limit(filters?.limit ?? 50)
      .offset(filters?.offset ?? 0)
      .execute();

    return { items, total };
  }

  async create(staff: NewStaffMember): Promise<StaffMember> {
    return this.db
      .insertInto('staff_members')
      .values(staff)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Serialize JSONB columns (permissions, settings) so pg driver sends valid JSON to Postgres.
   */
  async update(tenantId: string, id: string, updates: StaffMemberUpdate): Promise<StaffMember | undefined> {
    const setObj: Record<string, unknown> = {
      ...updates,
      updated_at: new Date(),
    };
    if (setObj.permissions !== undefined) {
      const arr = Array.isArray(setObj.permissions) ? setObj.permissions : [];
      setObj.permissions = JSON.stringify(arr);
    }
    if (setObj.settings !== undefined && typeof setObj.settings === 'object' && setObj.settings !== null && !Array.isArray(setObj.settings)) {
      setObj.settings = JSON.stringify(setObj.settings);
    }
    return this.db
      .updateTable('staff_members')
      .set(setObj as StaffMemberUpdate)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('staff_members')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0) > 0;
  }

  async updateLastActive(tenantId: string, id: string): Promise<void> {
    await this.db
      .updateTable('staff_members')
      .set({ last_active_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  async updateStatus(tenantId: string, id: string, status: StaffStatus): Promise<StaffMember | undefined> {
    return this.db
      .updateTable('staff_members')
      .set({ status })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async updateMetrics(tenantId: string, id: string, metrics: StaffMetrics): Promise<void> {
    await this.db
      .updateTable('staff_members')
      .set({ metrics })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  // =====================
  // Activity Log
  // =====================

  async logActivity(activity: NewStaffActivityLog): Promise<StaffActivityLog> {
    return this.db
      .insertInto('staff_activity_log')
      .values(activity)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getActivityLog(
    tenantId: string,
    filters?: {
      staffId?: string;
      action?: string;
      resourceType?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ items: StaffActivityLog[]; total: number }> {
    let query = this.db
      .selectFrom('staff_activity_log')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.staffId) {
      query = query.where('staff_id', '=', filters.staffId);
    }

    if (filters?.action) {
      query = query.where('action', '=', filters.action);
    }

    if (filters?.resourceType) {
      query = query.where('resource_type', '=', filters.resourceType);
    }

    if (filters?.startDate) {
      query = query.where('created_at', '>=', filters.startDate);
    }

    if (filters?.endDate) {
      query = query.where('created_at', '<=', filters.endDate);
    }

    // Count (simplified - doesn't apply all filters for performance)
    let countQuery = this.db
      .selectFrom('staff_activity_log')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId);
    
    if (filters?.staffId) {
      countQuery = countQuery.where('staff_id', '=', filters.staffId);
    }

    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count ?? 0);

    const items = await query
      .orderBy('created_at', 'desc')
      .limit(filters?.limit ?? 50)
      .offset(filters?.offset ?? 0)
      .execute();

    return { items, total };
  }

  async getStaffStats(tenantId: string, staffId: string): Promise<StaffMetrics> {
    // Get resolved task count
    const resolvedResult = await this.db
      .selectFrom('staff_activity_log')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .where('staff_id', '=', staffId)
      .where('action', '=', 'task_resolved')
      .executeTakeFirst();

    // Get expired task count
    const expiredResult = await this.db
      .selectFrom('staff_activity_log')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .where('staff_id', '=', staffId)
      .where('action', '=', 'task_expired')
      .executeTakeFirst();

    // Get average resolution time from details (using raw SQL for JSON path)
    const avgTimeResult = await this.db
      .selectFrom('staff_activity_log')
      .select(sql<number>`AVG((details->>'resolution_time_ms')::numeric)`.as('avg_time'))
      .where('tenant_id', '=', tenantId)
      .where('staff_id', '=', staffId)
      .where('action', '=', 'task_resolved')
      .executeTakeFirst();

    const resolved = Number(resolvedResult?.count ?? 0);
    const expired = Number(expiredResult?.count ?? 0);
    const total = resolved + expired;

    return {
      total_tasks: total,
      resolved_tasks: resolved,
      expired_tasks: expired,
      avg_resolution_time_ms: Number(avgTimeResult?.avg_time ?? 0),
      success_rate: total > 0 ? Math.round((resolved / total) * 100) : 0,
    };
  }

  // =====================
  // Sessions
  // =====================

  async createSession(session: NewStaffSession): Promise<StaffSession> {
    return this.db
      .insertInto('staff_sessions')
      .values(session)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getActiveSession(tokenHash: string): Promise<StaffSession | undefined> {
    return this.db
      .selectFrom('staff_sessions')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
  }

  async updateSessionHeartbeat(sessionId: string): Promise<void> {
    await this.db
      .updateTable('staff_sessions')
      .set({ last_heartbeat_at: new Date() })
      .where('id', '=', sessionId)
      .execute();
  }

  async deleteSession(tokenHash: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('staff_sessions')
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0) > 0;
  }

  async getOnlineStaff(tenantId: string): Promise<Array<{ staff: StaffMember; session: StaffSession }>> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const results = await this.db
      .selectFrom('staff_sessions')
      .innerJoin('staff_members', 'staff_members.id', 'staff_sessions.staff_id')
      .selectAll(['staff_members', 'staff_sessions'])
      .where('staff_sessions.tenant_id', '=', tenantId)
      .where('staff_sessions.last_heartbeat_at', '>', fiveMinutesAgo)
      .where('staff_sessions.expires_at', '>', new Date())
      .execute();

    // Transform results - need to separate staff and session
    return results.map(row => ({
      staff: {
        id: row.id,
        tenant_id: row.tenant_id,
        email: row.email,
        password_hash: row.password_hash,
        name: row.name,
        role: row.role,
        avatar_url: row.avatar_url,
        status: row.status,
        permissions: row.permissions,
        settings: row.settings,
        metrics: row.metrics,
        last_active_at: row.last_active_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      } as StaffMember,
      session: {
        // Session fields would need proper mapping
        status: row.status,
        last_heartbeat_at: row.last_heartbeat_at,
      } as unknown as StaffSession,
    }));
  }

  // =====================
  // Dashboard Stats
  // =====================

  async getDashboardStats(tenantId: string): Promise<{
    totalStaff: number;
    activeStaff: number;
    onlineNow: number;
    tasksToday: number;
    avgResolutionTime: string;
  }> {
    // Total staff
    const totalResult = await this.db
      .selectFrom('staff_members')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    // Active staff
    const activeResult = await this.db
      .selectFrom('staff_members')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    // Online now (heartbeat within 5 min)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineResult = await this.db
      .selectFrom('staff_sessions')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .where('last_heartbeat_at', '>', fiveMinutesAgo)
      .executeTakeFirst();

    // Tasks resolved today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tasksResult = await this.db
      .selectFrom('staff_activity_log')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenantId)
      .where('action', '=', 'task_resolved')
      .where('created_at', '>=', todayStart)
      .executeTakeFirst();

    return {
      totalStaff: Number(totalResult?.count ?? 0),
      activeStaff: Number(activeResult?.count ?? 0),
      onlineNow: Number(onlineResult?.count ?? 0),
      tasksToday: Number(tasksResult?.count ?? 0),
      avgResolutionTime: 'N/A', // Would need more complex query
    };
  }

  // =====================
  // Leaderboard
  // =====================

  async getLeaderboard(
    tenantId: string,
    period: 'today' | 'week' | 'month' | 'all' = 'week'
  ): Promise<Array<{ staffId: string; name: string; resolved: number; avgTime: number }>> {
    let startDate: Date | undefined;
    const now = new Date();

    switch (period) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      default:
        startDate = undefined;
    }

    let query = this.db
      .selectFrom('staff_activity_log')
      .innerJoin('staff_members', 'staff_members.id', 'staff_activity_log.staff_id')
      .select([
        'staff_activity_log.staff_id',
        'staff_members.name',
        (eb) => eb.fn.countAll().as('resolved'),
      ])
      .where('staff_activity_log.tenant_id', '=', tenantId)
      .where('staff_activity_log.action', '=', 'task_resolved')
      .groupBy(['staff_activity_log.staff_id', 'staff_members.name'])
      .orderBy('resolved', 'desc')
      .limit(10);

    if (startDate) {
      query = query.where('staff_activity_log.created_at', '>=', startDate);
    }

    const results = await query.execute();

    return results.map(r => ({
      staffId: r.staff_id,
      name: r.name,
      resolved: Number(r.resolved),
      avgTime: 0, // Would need separate query
    }));
  }
}
