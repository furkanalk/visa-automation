import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDb, TenantRepository } from '@visa-automation/db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    actorId?: string;
    actorType?: 'user' | 'system' | 'api' | 'agent';
    actorName?: string;
    roles?: string[];
  }
}

/**
 * Tenant isolation middleware
 * Extracts tenant context from request headers. Accepts tenant UUID or slug (resolved to UUID).
 * TODO: Replace x-tenant-id header with proper JWT authentication
 */
export async function tenantMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const path = request.url.split('?')[0];
  if (path.startsWith('/cp/auth')) {
    (request as FastifyRequest & { tenantId: string }).tenantId = '';
    return;
  }

  const tenantIdOrSlug = request.headers['x-tenant-id'] as string | undefined;

  if (!tenantIdOrSlug) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'AUTH_TENANT_MISSING',
        message: 'Tenant context required. Provide x-tenant-id header or authenticate with JWT.',
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  }

  let tenantId: string;
  if (UUID_REGEX.test(tenantIdOrSlug)) {
    tenantId = tenantIdOrSlug;
  } else {
    const tenantRepo = new TenantRepository(getDb());
    const tenant = await tenantRepo.findBySlug(tenantIdOrSlug);
    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AUTH_TENANT_NOT_FOUND',
          message: `Tenant not found: ${tenantIdOrSlug}`,
        },
        meta: {
          request_id: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
    tenantId = tenant.id;
  }

  // Extract actor info (for audit logging)
  const actorId = request.headers['x-actor-id'] as string | undefined;
  const actorType = (request.headers['x-actor-type'] as string | undefined) ?? 'user';
  const actorName = request.headers['x-actor-name'] as string | undefined;
  const roles = request.headers['x-roles'] as string | undefined;

  // Attach to request (always UUID so repos work)
  request.tenantId = tenantId;
  request.actorId = actorId;
  request.actorType = actorType as 'user' | 'system' | 'api' | 'agent';
  request.actorName = actorName;
  request.roles = roles?.split(',').map(r => r.trim()) ?? [];
}

/**
 * Role-based access control middleware factory
 */
export function requireRole(...allowedRoles: string[]) {
  return async function roleMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const userRoles = request.roles ?? [];
    
    // Super admin bypass
    if (userRoles.includes('super_admin')) {
      return;
    }

    const hasRole = allowedRoles.some(role => userRoles.includes(role));
    
    if (!hasRole) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'AUTH_INSUFFICIENT_PERMISSIONS',
          message: `Access denied. Required roles: ${allowedRoles.join(', ')}`,
        },
        meta: {
          request_id: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };
}
