import type { FastifyRequest, FastifyReply } from 'fastify';

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
 * Extracts tenant context from request headers/token and attaches to request
 * 
 * TODO: Replace x-tenant-id header with proper JWT authentication
 */
export async function tenantMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Extract tenant ID from header (temporary - should come from JWT)
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  
  if (!tenantId) {
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

  // Extract actor info (for audit logging)
  const actorId = request.headers['x-actor-id'] as string | undefined;
  const actorType = (request.headers['x-actor-type'] as string | undefined) ?? 'user';
  const actorName = request.headers['x-actor-name'] as string | undefined;
  const roles = request.headers['x-roles'] as string | undefined;

  // Attach to request
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
