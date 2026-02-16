/**
 * Fetches per-tenant notify settings from CP (GET /cp/notify/worker).
 * Caches by tenant for 5 minutes. Used by DP to send Telegram/email without env.
 */

export interface NotifySettingsFromCP {
  telegram_enabled: boolean;
  telegram_bot_token: string | null;
  telegram_chat_ids: string[];
  email_enabled: boolean;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  smtp_secure: boolean;
  fallback_email: string | null;
  email_override: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: NotifySettingsFromCP; expiresAt: number }>();

function fromRow(row: Record<string, unknown>): NotifySettingsFromCP {
  return {
    telegram_enabled: Boolean(row.telegram_enabled),
    telegram_bot_token: (row.telegram_bot_token as string) ?? null,
    telegram_chat_ids: Array.isArray(row.telegram_chat_ids) ? (row.telegram_chat_ids as string[]) : [],
    email_enabled: Boolean(row.email_enabled),
    smtp_host: (row.smtp_host as string) ?? null,
    smtp_port: typeof row.smtp_port === 'number' ? row.smtp_port : 587,
    smtp_user: (row.smtp_user as string) ?? null,
    smtp_pass: (row.smtp_pass as string) ?? null,
    smtp_from: (row.smtp_from as string) ?? null,
    smtp_secure: Boolean(row.smtp_secure),
    fallback_email: (row.fallback_email as string) ?? null,
    email_override: (row.email_override as string) ?? null,
  };
}

/**
 * Fetch notify settings for a tenant from CP. Cached for CACHE_TTL_MS.
 */
export async function getNotifySettings(
  cpApiUrl: string,
  tenantId: string,
  internalSecret: string
): Promise<NotifySettingsFromCP> {
  const now = Date.now();
  const entry = cache.get(tenantId);
  if (entry && entry.expiresAt > now) return entry.data;

  const base = cpApiUrl.replace(new RegExp('/+$'), '');
  const url = `${base}/cp/notify/worker`;
  const res = await fetch(url, {
    headers: {
      'x-tenant-id': tenantId,
      'x-internal-secret': internalSecret,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch notify settings: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { success?: boolean; data?: Record<string, unknown> };
  if (!body.success || !body.data) {
    throw new Error('Invalid notify settings response');
  }

  const data = fromRow(body.data);
  cache.set(tenantId, { data, expiresAt: now + CACHE_TTL_MS });
  return data;
}
