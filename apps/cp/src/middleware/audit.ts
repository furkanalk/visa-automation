import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDb, AuditRepository } from '@visa-automation/db';
import type { AuditChanges } from '@visa-automation/shared';

// Extend FastifyRequest to hold audit context
declare module 'fastify' {
  interface FastifyRequest {
    auditContext?: {
      body: unknown;
      startTime: number;
    };
  }
}

// Methods that should be audited
const AUDITABLE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Route patterns to resource types
const RESOURCE_MAP: Record<string, string> = {
  '/cp/agents': 'agent',
  '/cp/profiles': 'profile',
  '/cp/portals': 'portal',
  '/cp/notify': 'notify',
  '/cp/watcher': 'watcher',
};

// Fields to redact from audit logs
const SENSITIVE_FIELDS = [
  'password', 'pass', 'secret', 'token', 'api_key', 'apiKey',
  'telegram_bot_token', 'smtp_pass', 'webhook_secret',
];

/**
 * Pre-handler hook to capture request body for audit
 */
export async function auditPreHandler(request: FastifyRequest): Promise<void> {
  if (!AUDITABLE_METHODS.includes(request.method)) {
    return;
  }

  // Capture body and timing for later audit
  request.auditContext = {
    body: request.body ? redactSensitiveFields(request.body as Record<string, unknown>) : null,
    startTime: Date.now(),
  };
}

/**
 * OnSend hook to write audit log after response is ready
 */
export async function auditOnSend(
  request: FastifyRequest,
  reply: FastifyReply,
  _payload: unknown
): Promise<void> {
  // Skip non-auditable methods
  if (!AUDITABLE_METHODS.includes(request.method)) {
    return;
  }

  // Skip if no tenant (shouldn't happen but safety check)
  if (!request.tenantId) {
    return;
  }

  try {
    const auditRepo = new AuditRepository(getDb());
    
    // Determine resource type and ID from URL
    const url = request.url;
    let resourceType = 'unknown';
    let resourceId: string | undefined;

    for (const [pattern, type] of Object.entries(RESOURCE_MAP)) {
      if (url.startsWith(pattern)) {
        resourceType = type;
        // Extract ID from URL if present (e.g., /cp/agents/123 -> 123)
        const parts = url.replace(pattern, '').split('/').filter(Boolean);
        if (parts.length > 0 && !parts[0].includes('?')) {
          resourceId = parts[0].split('?')[0];
        }
        break;
      }
    }

    // Determine action from method and URL
    const action = determineAction(request.method, url, resourceType);
    const isSuccess = reply.statusCode < 400;

    // Build changes object
    const changes: AuditChanges | null = request.auditContext?.body ? {
      after: request.auditContext.body as Record<string, unknown>,
    } : null;

    // When auditing agent resource, if no actor (e.g. request from worker), use resource as actor
    let actorType = request.actorType ?? 'user';
    let actorId = request.actorId;
    let actorName = request.actorName;
    if (resourceType === 'agent' && (actorId == null || actorName == null) && resourceId) {
      actorType = 'agent';
      actorId = resourceId;
      actorName = actorName ?? `Agent ${resourceId.slice(0, 8)}`;
    }

    await auditRepo.create({
      tenant_id: request.tenantId,
      actor_type: actorType,
      actor_id: actorId,
      actor_name: actorName,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      changes,
      metadata: {
        request_id: request.id,
        status_code: reply.statusCode,
        success: isSuccess,
        method: request.method,
        url: request.url,
        duration_ms: request.auditContext?.startTime 
          ? Date.now() - request.auditContext.startTime 
          : undefined,
      },
      ip_address: request.ip,
      user_agent: request.headers['user-agent'] ?? null,
    });
  } catch (err) {
    // Don't fail the request if audit logging fails
    request.log.error({ err }, 'Failed to create audit log');
  }
}

/**
 * Redact sensitive fields from an object
 */
function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
      redacted[key] = '***REDACTED***';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

function determineAction(method: string, url: string, resourceType: string): string {
  // Special action mappings
  if (url.includes('/bulk-assign-profile')) return 'agent.bulk_assign_profile';
  if (url.includes('/scale')) return 'agent.scale';
  if (url.includes('/heartbeat')) return 'agent.heartbeat';
  if (url.includes('/assign-portals')) return 'agent.assign_portals';
  if (url.includes('/assign-agents')) return 'portal.assign_agents';
  if (url.includes('/enable')) return `${resourceType}.enable`;
  if (url.includes('/disable')) return `${resourceType}.disable`;
  if (url.includes('/test/telegram')) return 'notify.test_telegram';
  if (url.includes('/test/email')) return 'notify.test_email';
  if (url.includes('/test/webhook')) return 'notify.test_webhook';
  if (url.includes('/run-now')) return 'watcher.run_now';

  // Default action mapping
  switch (method) {
    case 'POST':
      return `${resourceType}.create`;
    case 'PUT':
    case 'PATCH':
      return `${resourceType}.update`;
    case 'DELETE':
      return `${resourceType}.delete`;
    default:
      return `${resourceType}.${method.toLowerCase()}`;
  }
}
