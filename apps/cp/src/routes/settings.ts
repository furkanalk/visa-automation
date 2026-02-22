import type { FastifyPluginAsync } from 'fastify';
import { getDb, SystemSettingsRepository, AuditRepository } from '@visa-automation/db';

interface SettingParams {
  category: string;
  key: string;
}

interface BulkUpdateBody {
  updates: Array<{ category: string; key: string; value: unknown }>;
}

interface SetValueBody {
  value: unknown;
  description?: string;
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const settingsRepo = new SystemSettingsRepository(db);
  const auditRepo = new AuditRepository(db);

  /**
   * Get all settings grouped by category.
   * Returns config_updated_at (max updated_at) for conditional refetch.
   * If X-Config-Updated-At matches current max, returns 304 Not Modified.
   */
  app.get<{
    Querystring: { category?: string };
  }>('/', async (request, reply) => {
    const { category } = request.query;
    const maxUpdatedAt = await settingsRepo.getMaxUpdatedAt(request.tenantId);
    const configUpdatedAt = maxUpdatedAt?.toISOString() ?? '';

    const clientUpdatedAt = request.headers['x-config-updated-at'] as string | undefined;
    if (clientUpdatedAt && configUpdatedAt && clientUpdatedAt === configUpdatedAt) {
      return reply.status(304).send();
    }

    if (category) {
      const settings = await settingsRepo.getCategoryAsObject(request.tenantId, category);
      return {
        success: true,
        data: { [category]: settings },
        config_updated_at: configUpdatedAt,
      };
    }

    const allSettings = await settingsRepo.getAllGrouped(request.tenantId);
    return {
      success: true,
      data: allSettings,
      config_updated_at: configUpdatedAt,
    };
  });

  /**
   * Get all settings as flat list
   * GET /cp/settings/list
   */
  app.get<{
    Querystring: { category?: string };
  }>('/list', async (request) => {
    const settings = await settingsRepo.findByTenant(request.tenantId, request.query.category);
    
    return {
      success: true,
      data: {
        items: settings.map((s) => ({
          ...s,
          // Redact sensitive values
          value: s.is_sensitive ? '********' : s.value,
          isGlobal: s.tenant_id === null,
        })),
        total: settings.length,
      },
    };
  });

  /**
   * Get available categories
   * GET /cp/settings/categories
   */
  app.get('/categories', async () => {
    const categories = await settingsRepo.getCategories();
    return {
      success: true,
      data: { categories },
    };
  });

  /**
   * Get a specific setting value
   * GET /cp/settings/:category/:key
   */
  app.get<{ Params: SettingParams }>('/:category/:key', async (request, reply) => {
    const { category, key } = request.params;
    const value = await settingsRepo.getValue(request.tenantId, category, key);

    if (value === undefined) {
      return reply.status(404).send({
        success: false,
        error: { code: 'SETTING_NOT_FOUND', message: `Setting ${category}.${key} not found` },
      });
    }

    return {
      success: true,
      data: { category, key, value },
    };
  });

  /**
   * Set/update a setting value (tenant-specific)
   * PUT /cp/settings/:category/:key
   */
  app.put<{ Params: SettingParams; Body: SetValueBody }>('/:category/:key', async (request) => {
    const { category, key } = request.params;
    const { value, description } = request.body;

    // Get old value for audit
    const oldValue = await settingsRepo.getValue(request.tenantId, category, key);

    const setting = await settingsRepo.setValue(
      request.tenantId,
      category,
      key,
      value,
      {
        description,
        updatedBy: request.actorId || request.actorName || 'admin',
      }
    );

    // Audit log
    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'update',
      resource_type: 'setting',
      resource_id: `${category}.${key}`,
      changes: { before: { value: oldValue }, after: { value } },
      ip_address: request.ip,
    });

    return {
      success: true,
      data: setting,
    };
  });

  /**
   * Bulk update settings
   * PATCH /cp/settings/bulk
   */
  app.patch<{ Body: BulkUpdateBody }>('/bulk', async (request) => {
    const { updates } = request.body;
    const updatedBy = request.actorId || request.actorName || 'admin';

    await settingsRepo.bulkUpdate(request.tenantId, updates, updatedBy);

    // Sync mock category to global so DP (any tenant) sees it when tenant-specific is missing
    const mockUpdates = updates.filter((u) => u.category === 'mock');
    if (mockUpdates.length > 0) {
      await settingsRepo.bulkUpdate(null, mockUpdates, updatedBy);
    }

    // Sync notify action token/URL to global so all DP workers see it regardless of tenant
    const notifyActionKeys = ['notify_action_token', 'notify_action_base_url'];
    const notifyActionUpdates = updates.filter(
      (u) => u.category === 'notify' && notifyActionKeys.includes(u.key)
    );
    if (notifyActionUpdates.length > 0) {
      await settingsRepo.bulkUpdate(null, notifyActionUpdates, updatedBy);
    }

    // Audit log
    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'bulk_update',
      resource_type: 'settings',
      resource_id: null,
      changes: { after: { updated: updates.map((u) => `${u.category}.${u.key}`) } },
      ip_address: request.ip,
    });

    return {
      success: true,
      data: { updated: updates.length },
    };
  });

  /**
   * Delete a tenant-specific setting (falls back to global)
   * DELETE /cp/settings/:category/:key
   */
  app.delete<{ Params: SettingParams }>('/:category/:key', async (request, reply) => {
    const { category, key } = request.params;

    const deleted = await settingsRepo.deleteTenantSetting(request.tenantId, category, key);

    if (!deleted) {
      return reply.status(404).send({
        success: false,
        error: { code: 'SETTING_NOT_FOUND', message: `Tenant setting ${category}.${key} not found` },
      });
    }

    // Audit log
    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'delete',
      resource_type: 'setting',
      resource_id: `${category}.${key}`,
      ip_address: request.ip,
    });

    return {
      success: true,
      data: { deleted: true, message: 'Setting reset to global default' },
    };
  });

  /**
   * Get global settings (admin only)
   * GET /cp/settings/global
   */
  app.get('/global', async () => {
    const settings = await settingsRepo.getGlobalSettings();
    return {
      success: true,
      data: {
        items: settings.map((s) => ({
          ...s,
          value: s.is_sensitive ? '********' : s.value,
        })),
        total: settings.length,
      },
    };
  });

  /**
   * Update global setting (super admin only)
   * PUT /cp/settings/global/:category/:key
   */
  app.put<{ Params: SettingParams; Body: SetValueBody }>('/global/:category/:key', async (request) => {
    const { category, key } = request.params;
    const { value, description } = request.body;

    // Get old value for audit
    const oldValue = await settingsRepo.getValue(null, category, key);

    const setting = await settingsRepo.setValue(
      null, // null tenant_id = global
      category,
      key,
      value,
      {
        description,
        updatedBy: request.actorId || request.actorName || 'super_admin',
      }
    );

    // Audit log
    await auditRepo.create({
      tenant_id: null,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'update_global',
      resource_type: 'setting',
      resource_id: `${category}.${key}`,
      changes: { before: { value: oldValue }, after: { value } },
      ip_address: request.ip,
    });

    return {
      success: true,
      data: setting,
    };
  });
};
