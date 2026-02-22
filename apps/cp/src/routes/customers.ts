import type { FastifyPluginAsync } from 'fastify';
import { getDb, CustomerRepository, AuditRepository } from '@visa-automation/db';
import type { CustomerStatus, CustomerPreferences, CustomerFlags, SlotCheckPolicy } from '@visa-automation/db';
import { JobService } from '../services/job.service.js';
import type { ApplicantData } from '@visa-automation/shared';

interface CustomerParams {
  id: string;
}

interface CreateCustomerBody {
  display_name: string;
  internal_ref?: string;
  tags?: string[];
  portal_id: string;
  profile_id?: string;
  priority?: number;
  notify_email?: string;
  notify_phone?: string;
  notify_telegram_chat_id?: string;
  preferences?: CustomerPreferences;
  flags?: CustomerFlags;
  slot_check_policy?: SlotCheckPolicy;
}

interface UpdateCustomerBody {
  display_name?: string;
  internal_ref?: string;
  tags?: string[];
  portal_id?: string;
  profile_id?: string | null;
  status?: CustomerStatus;
  priority?: number;
  notify_email?: string | null;
  notify_phone?: string | null;
  notify_telegram_chat_id?: string | null;
  preferences?: CustomerPreferences;
  flags?: CustomerFlags;
  slot_check_policy?: SlotCheckPolicy;
}

interface CustomerSecretsBody {
  passport_no?: string | null;
  id_no?: string | null;
  birth_date?: string | null;
  full_name?: string | null;
  nationality?: string | null;
  portal_username?: string | null;
  portal_password?: string | null;
  extra_fields?: Record<string, unknown>;
}

interface ListCustomersQuery {
  status?: string;
  portal_id?: string;
  profile_id?: string;
  tags?: string;
  search?: string;
  priority_min?: string;
  priority_max?: string;
  limit?: string;
  offset?: string;
}

export const customerRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const customerRepo = new CustomerRepository(db);
  const auditRepo = new AuditRepository(db);

  /**
   * List customers with filters
   * GET /cp/customers
   */
  app.get<{ Querystring: ListCustomersQuery }>('/', async (request) => {
    const {
      status,
      portal_id,
      profile_id,
      tags,
      search,
      priority_min,
      priority_max,
      limit = '20',
      offset = '0',
    } = request.query;

    const filters: Parameters<typeof customerRepo.findWithFilters>[0] = {
      tenantId: request.tenantId,
      limit: Math.min(parseInt(limit, 10), 100),
      offset: parseInt(offset, 10),
    };

    if (status) {
      const statuses = status.split(',') as CustomerStatus[];
      filters.status = statuses.length === 1 ? statuses[0] : statuses;
    }
    if (portal_id) filters.portalId = portal_id;
    if (profile_id) filters.profileId = profile_id;
    if (tags) filters.tags = tags.split(',');
    if (search) filters.search = search;
    if (priority_min || priority_max) {
      filters.priority = {};
      if (priority_min) filters.priority.min = parseInt(priority_min, 10);
      if (priority_max) filters.priority.max = parseInt(priority_max, 10);
    }

    const result = await customerRepo.findWithFilters(filters);
    const counts = await customerRepo.countByTenant(request.tenantId);

    return {
      success: true,
      data: {
        items: result.items,
        total: result.total,
        counts,
      },
    };
  });

  /**
   * Get customer counts by status
   * GET /cp/customers/counts
   */
  app.get('/counts', async (request) => {
    const counts = await customerRepo.countByTenant(request.tenantId);
    return {
      success: true,
      data: counts,
    };
  });

  /**
   * Get customer by ID
   * GET /cp/customers/:id
   */
  app.get<{ Params: CustomerParams; Querystring: { include_secrets?: string } }>(
    '/:id',
    async (request, reply) => {
      const includeSecrets = request.query.include_secrets === 'true';

      const customer = includeSecrets
        ? await customerRepo.findByIdWithSecrets(request.tenantId, request.params.id)
        : await customerRepo.findById(request.tenantId, request.params.id);

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
        });
      }

      return {
        success: true,
        data: customer,
      };
    }
  );

  /**
   * Get customer redacted view (for staff)
   * GET /cp/customers/:id/redacted
   */
  app.get<{ Params: CustomerParams }>('/:id/redacted', async (request, reply) => {
    const customer = await customerRepo.getRedactedView(request.tenantId, request.params.id);

    if (!customer) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      });
    }

    return {
      success: true,
      data: customer,
    };
  });

  /**
   * List customers with redacted info (for staff)
   * GET /cp/customers/redacted
   */
  app.get<{
    Querystring: {
      status?: string;
      portal_id?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>('/redacted', async (request) => {
    const { status, portal_id, search, limit, offset } = request.query;

    const result = await customerRepo.getRedactedList(request.tenantId, {
      status: status as 'active' | 'paused' | 'completed' | 'cancelled' | undefined,
      portalId: portal_id,
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
   * Create customer
   * POST /cp/customers
   */
  app.post<{ Body: CreateCustomerBody }>('/', async (request) => {
    const {
      display_name,
      internal_ref,
      tags,
      portal_id,
      profile_id,
      priority,
      notify_email,
      notify_phone,
      notify_telegram_chat_id,
      preferences,
      flags,
      slot_check_policy,
    } = request.body;

    const customer = await customerRepo.create({
      tenant_id: request.tenantId,
      display_name,
      internal_ref: internal_ref ?? null,
      tags: tags ?? [],
      portal_id,
      profile_id: profile_id ?? null,
      status: 'active',
      priority: priority ?? 50,
      notify_email: notify_email ?? null,
      notify_phone: notify_phone ?? null,
      notify_telegram_chat_id: notify_telegram_chat_id ?? null,
      preferences: preferences ?? {},
      flags: flags ?? {},
      slot_check_policy: slot_check_policy ?? {},
      created_by: request.actorId || request.actorName,
    });

    // Audit log
    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'create',
      resource_type: 'customer',
      resource_id: customer.id,
      changes: { after: { display_name, portal_id, status: 'active' } },
      ip_address: request.ip,
    });

    return {
      success: true,
      data: customer,
    };
  });

  /**
   * Update customer
   * PATCH /cp/customers/:id
   */
  app.patch<{ Params: CustomerParams; Body: UpdateCustomerBody }>(
    '/:id',
    async (request, reply) => {
      const existing = await customerRepo.findById(request.tenantId, request.params.id);
      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
        });
      }

      const updates: Record<string, unknown> = {
        updated_by: request.actorId || request.actorName,
      };

      const body = request.body;
      if (body.display_name !== undefined) updates.display_name = body.display_name;
      if (body.internal_ref !== undefined) updates.internal_ref = body.internal_ref;
      if (body.tags !== undefined) updates.tags = body.tags;
      if (body.portal_id !== undefined) updates.portal_id = body.portal_id;
      if (body.profile_id !== undefined) updates.profile_id = body.profile_id;
      if (body.status !== undefined) updates.status = body.status;
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.notify_email !== undefined) updates.notify_email = body.notify_email;
      if (body.notify_phone !== undefined) updates.notify_phone = body.notify_phone;
      if (body.notify_telegram_chat_id !== undefined) updates.notify_telegram_chat_id = body.notify_telegram_chat_id;
      if (body.preferences !== undefined) updates.preferences = body.preferences;
      if (body.flags !== undefined) updates.flags = body.flags;
      if (body.slot_check_policy !== undefined) updates.slot_check_policy = body.slot_check_policy;

      const customer = await customerRepo.update(request.tenantId, request.params.id, updates);

      // Audit log
      await auditRepo.create({
        tenant_id: request.tenantId,
        actor_type: request.actorType ?? 'user',
        actor_id: request.actorId,
        actor_name: request.actorName,
        action: 'update',
        resource_type: 'customer',
        resource_id: request.params.id,
        changes: { before: { status: existing.status }, after: updates },
        ip_address: request.ip,
      });

      return {
        success: true,
        data: customer,
      };
    }
  );

  /**
   * Delete customer (soft delete)
   * DELETE /cp/customers/:id
   */
  app.delete<{ Params: CustomerParams; Querystring: { hard?: string } }>(
    '/:id',
    async (request, reply) => {
      const isHardDelete = request.query.hard === 'true';
      const existing = await customerRepo.findById(request.tenantId, request.params.id);

      if (!existing) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
        });
      }

      if (isHardDelete) {
        await customerRepo.delete(request.tenantId, request.params.id);
      } else {
        await customerRepo.softDelete(request.tenantId, request.params.id, request.actorId || request.actorName);
      }

      // Audit log
      await auditRepo.create({
        tenant_id: request.tenantId,
        actor_type: request.actorType ?? 'user',
        actor_id: request.actorId,
        actor_name: request.actorName,
        action: isHardDelete ? 'hard_delete' : 'soft_delete',
        resource_type: 'customer',
        resource_id: request.params.id,
        ip_address: request.ip,
      });

      return {
        success: true,
        data: { deleted: true },
      };
    }
  );

  /**
   * Pause customer
   * POST /cp/customers/:id/pause
   */
  app.post<{ Params: CustomerParams }>('/:id/pause', async (request, reply) => {
    const customer = await customerRepo.pause(
      request.tenantId,
      request.params.id,
      request.actorId || request.actorName
    );

    if (!customer) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      });
    }

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'pause',
      resource_type: 'customer',
      resource_id: request.params.id,
      ip_address: request.ip,
    });

    return {
      success: true,
      data: customer,
    };
  });

  /**
   * Resume customer
   * POST /cp/customers/:id/resume
   */
  app.post<{ Params: CustomerParams }>('/:id/resume', async (request, reply) => {
    const customer = await customerRepo.resume(
      request.tenantId,
      request.params.id,
      request.actorId || request.actorName
    );

    if (!customer) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      });
    }

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'resume',
      resource_type: 'customer',
      resource_id: request.params.id,
      ip_address: request.ip,
    });

    return {
      success: true,
      data: customer,
    };
  });

  /**
   * Get/Update customer secrets
   * GET /cp/customers/:id/secrets
   */
  app.get<{ Params: CustomerParams }>('/:id/secrets', async (request, reply) => {
    const customer = await customerRepo.findById(request.tenantId, request.params.id);
    if (!customer) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      });
    }

    const secrets = await customerRepo.getSecrets(request.params.id);
    return {
      success: true,
      data: secrets || null,
    };
  });

  /**
   * Update customer secrets
   * PUT /cp/customers/:id/secrets
   */
  app.put<{ Params: CustomerParams; Body: CustomerSecretsBody }>(
    '/:id/secrets',
    async (request, reply) => {
      const customer = await customerRepo.findById(request.tenantId, request.params.id);
      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
        });
      }

      const { birth_date, ...rest } = request.body;
      const secrets = await customerRepo.upsertSecrets(request.params.id, {
        ...rest,
        birth_date: birth_date ? new Date(birth_date) : null,
      });

      // Audit log (don't log actual secret values)
      await auditRepo.create({
        tenant_id: request.tenantId,
        actor_type: request.actorType ?? 'user',
        actor_id: request.actorId,
        actor_name: request.actorName,
        action: 'update_secrets',
        resource_type: 'customer',
        resource_id: request.params.id,
        changes: { after: { fields_updated: Object.keys(request.body) } },
        ip_address: request.ip,
      });

      return {
        success: true,
        data: secrets,
      };
    }
  );

  /**
   * Get customer jobs
   * GET /cp/customers/:id/jobs
   */
  app.get<{ Params: CustomerParams; Querystring: { limit?: string; offset?: string } }>(
    '/:id/jobs',
    async (request, reply) => {
      const customer = await customerRepo.findById(request.tenantId, request.params.id);
      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
        });
      }

      // TODO: Filter jobs by customer_id once migration is applied
      // For now return placeholder response
      return {
        success: true,
        data: {
          items: [],
          total: 0,
          message: 'Customer job filtering will be available after migration is applied',
        },
      };
    }
  );

  /**
   * Trigger slot check for customer (manual run)
   * POST /cp/customers/:id/run-slot-check
   */
  app.post<{ Params: CustomerParams }>('/:id/run-slot-check', async (request, reply) => {
    const customer = await customerRepo.findById(request.tenantId, request.params.id);
    if (!customer) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      });
    }

    if (customer.status !== 'active') {
      return reply.status(400).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_ACTIVE', message: 'Customer is not active' },
      });
    }

    const prefs = (customer.preferences ?? {}) as Record<string, unknown>;
    const applicant: ApplicantData = {
      ...prefs,
      name: (typeof prefs.name === 'string' ? prefs.name : null) || customer.display_name,
    };

    let result: { job_id: string };
    try {
      const jobService = new JobService();
      result = await jobService.createJob({
        tenant_id: request.tenantId,
        portal_id: customer.portal_id,
        visa_type: 'SCHENGEN',
        priority: customer.priority,
        applicant,
      });
    } catch (err) {
      request.log.error({ err, customerId: customer.id }, 'Failed to create job for customer');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'JOB_CREATE_FAILED',
          message: err instanceof Error ? err.message : 'Failed to create job',
        },
      });
    }

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: 'trigger_slot_check',
      resource_type: 'customer',
      resource_id: request.params.id,
      ip_address: request.ip,
      metadata: { job_id: result.job_id },
    });

    return {
      success: true,
      data: {
        message: 'Slot check started.',
        customer_id: customer.id,
        job_id: result.job_id,
      },
    };
  });

  /**
   * Bulk operations
   * POST /cp/customers/bulk
   */
  app.post<{
    Body: {
      action: 'pause' | 'resume' | 'assign_profile' | 'update_status';
      ids: string[];
      profile_id?: string;
      status?: CustomerStatus;
    };
  }>('/bulk', async (request) => {
    const { action, ids, profile_id, status } = request.body;
    let affected = 0;

    switch (action) {
      case 'pause':
        affected = await customerRepo.bulkUpdateStatus(
          request.tenantId,
          ids,
          'paused',
          request.actorId || request.actorName
        );
        break;
      case 'resume':
        affected = await customerRepo.bulkUpdateStatus(
          request.tenantId,
          ids,
          'active',
          request.actorId || request.actorName
        );
        break;
      case 'assign_profile':
        if (profile_id === undefined) {
          return { success: false, error: { code: 'MISSING_PROFILE_ID', message: 'profile_id required' } };
        }
        affected = await customerRepo.bulkAssignProfile(
          request.tenantId,
          ids,
          profile_id || null,
          request.actorId || request.actorName
        );
        break;
      case 'update_status':
        if (!status) {
          return { success: false, error: { code: 'MISSING_STATUS', message: 'status required' } };
        }
        affected = await customerRepo.bulkUpdateStatus(
          request.tenantId,
          ids,
          status,
          request.actorId || request.actorName
        );
        break;
    }

    // Audit log
    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: request.actorType ?? 'user',
      actor_id: request.actorId,
      actor_name: request.actorName,
      action: `bulk_${action}`,
      resource_type: 'customer',
      resource_id: null,
      changes: { after: { ids, affected } },
      ip_address: request.ip,
    });

    return {
      success: true,
      data: { affected, action },
    };
  });
};
