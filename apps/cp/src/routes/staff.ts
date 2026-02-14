import type { FastifyPluginCallback } from 'fastify';
import { getDb, StaffRepository, AuditRepository } from '@visa-automation/db';
import type { StaffStatus, StaffRole } from '@visa-automation/db';

// Request/Response types
interface StaffParams {
  id: string;
}

interface ListStaffQuery {
  status?: StaffStatus;
  role?: StaffRole;
  search?: string;
  limit?: string;
  offset?: string;
}

interface CreateStaffBody {
  email: string;
  name: string;
  role?: StaffRole;
  permissions?: string[];
  settings?: Record<string, unknown>;
}

interface UpdateStaffBody {
  name?: string;
  role?: StaffRole;
  status?: StaffStatus;
  permissions?: string[];
  settings?: Record<string, unknown>;
  avatar_url?: string;
}

interface ActivityLogQuery {
  staff_id?: string;
  action?: string;
  resource_type?: string;
  start_date?: string;
  end_date?: string;
  limit?: string;
  offset?: string;
}

interface LeaderboardQuery {
  period?: 'today' | 'week' | 'month' | 'all';
}

export const staffRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const db = getDb();
  const staffRepo = new StaffRepository(db);
  const auditRepo = new AuditRepository(db);

  /**
   * List staff members
   * GET /cp/staff
   */
  app.get<{ Querystring: ListStaffQuery }>('/staff', async (request) => {
    const { status, role, search, limit, offset } = request.query;

    const result = await staffRepo.list(request.tenantId, {
      status,
      role,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return {
      success: true,
      data: result,
    };
  });

  /**
   * Get staff notifications feed (stub: empty until notification feed backend exists)
   * GET /cp/staff/notifications
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/staff/notifications', async (request) => {
    const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);
    const offset = parseInt(request.query.offset || '0', 10);
    return {
      success: true,
      data: { items: [], total: 0, limit, offset },
    };
  });

  /**
   * Mark staff notification as read (stub: no-op until notification feed backend exists)
   * POST /cp/staff/notifications/:id/read
   */
  app.post<{ Params: { id: string } }>('/staff/notifications/:id/read', async () => {
    return { success: true, data: { success: true } };
  });

  /**
   * Get single staff member
   * GET /cp/staff/:id
   */
  app.get<{ Params: StaffParams }>('/staff/:id', async (request, reply) => {
    const staff = await staffRepo.findById(request.tenantId, request.params.id);

    if (!staff) {
      return reply.status(404).send({
        success: false,
        error: { code: 'STAFF_NOT_FOUND', message: 'Staff member not found' },
      });
    }

    // Get fresh stats
    const stats = await staffRepo.getStaffStats(request.tenantId, staff.id);

    return {
      success: true,
      data: { ...staff, metrics: stats },
    };
  });

  /**
   * Create staff member
   * POST /cp/staff
   */
  app.post<{ Body: CreateStaffBody }>('/staff', async (request) => {
    const { email, name, role = 'staff', permissions = [], settings = {} } = request.body;

    const staff = await staffRepo.create({
      tenant_id: request.tenantId,
      email,
      name,
      role,
      permissions,
      settings,
      status: 'active',
    });

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_id: request.actorId,
      actor_type: request.actorType ?? 'user',
      action: 'staff.create',
      resource_type: 'staff_member',
      resource_id: staff.id,
      changes: { after: { email, name, role } },
    });

    return {
      success: true,
      data: staff,
    };
  });

  /**
   * Update staff member
   * PATCH /cp/staff/:id
   */
  app.patch<{ Params: StaffParams; Body: UpdateStaffBody }>('/staff/:id', async (request, reply) => {
    const existing = await staffRepo.findById(request.tenantId, request.params.id);

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'STAFF_NOT_FOUND', message: 'Staff member not found' },
      });
    }

    const updates: Record<string, unknown> = {};
    if (request.body.name !== undefined) updates.name = request.body.name;
    if (request.body.role !== undefined) updates.role = request.body.role;
    if (request.body.status !== undefined) updates.status = request.body.status;
    if (request.body.permissions !== undefined) updates.permissions = request.body.permissions;
    if (request.body.settings !== undefined) updates.settings = request.body.settings;
    if (request.body.avatar_url !== undefined) updates.avatar_url = request.body.avatar_url;

    const staff = await staffRepo.update(request.tenantId, request.params.id, updates);

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_id: request.actorId,
      actor_type: request.actorType ?? 'user',
      action: 'staff.update',
      resource_type: 'staff_member',
      resource_id: request.params.id,
      changes: { before: existing, after: updates },
    });

    return {
      success: true,
      data: staff,
    };
  });

  /**
   * Delete staff member
   * DELETE /cp/staff/:id
   */
  app.delete<{ Params: StaffParams }>('/staff/:id', async (request, reply) => {
    const existing = await staffRepo.findById(request.tenantId, request.params.id);

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'STAFF_NOT_FOUND', message: 'Staff member not found' },
      });
    }

    await staffRepo.delete(request.tenantId, request.params.id);

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_id: request.actorId,
      actor_type: request.actorType ?? 'user',
      action: 'staff.delete',
      resource_type: 'staff_member',
      resource_id: request.params.id,
      changes: { before: existing },
    });

    return {
      success: true,
      data: { message: 'Staff member deleted' },
    };
  });

  /**
   * Get staff activity log
   * GET /cp/staff/activity
   */
  app.get<{ Querystring: ActivityLogQuery }>('/staff/activity', async (request) => {
    const { staff_id, action, resource_type, start_date, end_date, limit, offset } = request.query;

    const result = await staffRepo.getActivityLog(request.tenantId, {
      staffId: staff_id,
      action,
      resourceType: resource_type,
      startDate: start_date ? new Date(start_date) : undefined,
      endDate: end_date ? new Date(end_date) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return {
      success: true,
      data: result,
    };
  });

  /**
   * Get staff activity for specific member
   * GET /cp/staff/:id/activity
   */
  app.get<{ Params: StaffParams; Querystring: ActivityLogQuery }>('/staff/:id/activity', async (request) => {
    const { action, resource_type, start_date, end_date, limit, offset } = request.query;

    const result = await staffRepo.getActivityLog(request.tenantId, {
      staffId: request.params.id,
      action,
      resourceType: resource_type,
      startDate: start_date ? new Date(start_date) : undefined,
      endDate: end_date ? new Date(end_date) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return {
      success: true,
      data: result,
    };
  });

  /**
   * Get dashboard stats
   * GET /cp/staff/dashboard
   */
  app.get('/staff/dashboard', async (request) => {
    const stats = await staffRepo.getDashboardStats(request.tenantId);
    return {
      success: true,
      data: stats,
    };
  });

  /**
   * Get leaderboard
   * GET /cp/staff/leaderboard
   */
  app.get<{ Querystring: LeaderboardQuery }>('/staff/leaderboard', async (request) => {
    const { period = 'week' } = request.query;
    const leaderboard = await staffRepo.getLeaderboard(request.tenantId, period);
    return {
      success: true,
      data: leaderboard,
    };
  });

  /**
   * Get online staff
   * GET /cp/staff/online
   */
  app.get('/staff/online', async (request) => {
    const online = await staffRepo.getOnlineStaff(request.tenantId);
    return {
      success: true,
      data: online,
    };
  });

  /**
   * Suspend staff member
   * POST /cp/staff/:id/suspend
   */
  app.post<{ Params: StaffParams }>('/staff/:id/suspend', async (request, reply) => {
    const existing = await staffRepo.findById(request.tenantId, request.params.id);

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'STAFF_NOT_FOUND', message: 'Staff member not found' },
      });
    }

    const staff = await staffRepo.updateStatus(request.tenantId, request.params.id, 'suspended');

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_id: request.actorId,
      actor_type: request.actorType ?? 'user',
      action: 'staff.suspend',
      resource_type: 'staff_member',
      resource_id: request.params.id,
      changes: { before: { status: existing.status }, after: { status: 'suspended' } },
    });

    return {
      success: true,
      data: staff,
    };
  });

  /**
   * Activate staff member
   * POST /cp/staff/:id/activate
   */
  app.post<{ Params: StaffParams }>('/staff/:id/activate', async (request, reply) => {
    const existing = await staffRepo.findById(request.tenantId, request.params.id);

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'STAFF_NOT_FOUND', message: 'Staff member not found' },
      });
    }

    const staff = await staffRepo.updateStatus(request.tenantId, request.params.id, 'active');

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_id: request.actorId,
      actor_type: request.actorType ?? 'user',
      action: 'staff.activate',
      resource_type: 'staff_member',
      resource_id: request.params.id,
      changes: { before: { status: existing.status }, after: { status: 'active' } },
    });

    return {
      success: true,
      data: staff,
    };
  });

  done();
};
