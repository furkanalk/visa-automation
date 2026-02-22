import type { FastifyBaseLogger } from 'fastify';
import { getDb, NotifyRepository } from '@visa-automation/db';

/**
 * Send a Telegram message to the Ops chat for a tenant.
 * Uses first chat ID from notify_settings.telegram_chat_ids (Ops).
 * No-op if Telegram is disabled or not configured.
 */
export async function sendTelegramToOps(
  tenantId: string,
  text: string,
  logger: FastifyBaseLogger
): Promise<void> {
  const notifyRepo = new NotifyRepository(getDb());
  const settings = await notifyRepo.findByTenantId(tenantId);
  if (!settings?.telegram_enabled || !settings.telegram_bot_token) {
    logger.debug({ tenantId }, 'Telegram to Ops skipped: disabled or not configured');
    return;
  }
  const chatIds = settings.telegram_chat_ids ?? [];
  if (chatIds.length === 0) {
    logger.debug({ tenantId }, 'Telegram to Ops skipped: no chat IDs');
    return;
  }
  // First entry is Ops (same convention as DP notify)
  const entry = chatIds[0];
  const [chatIdPart, threadIdStr] = entry.includes(':') ? entry.split(':') : [entry.trim(), ''];
  const chat_id = chatIdPart.trim();
  const message_thread_id = threadIdStr ? parseInt(threadIdStr, 10) : undefined;
  const payload: Record<string, unknown> = {
    chat_id,
    text,
    parse_mode: 'HTML',
  };
  if (message_thread_id != null && !Number.isNaN(message_thread_id)) {
    payload.message_thread_id = message_thread_id;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = (await res.json()) as { ok: boolean; description?: string };
    if (!result.ok) {
      logger.warn({ tenantId, err: result.description }, 'Telegram send to Ops failed');
    }
  } catch (err) {
    logger.warn({ err, tenantId }, 'Telegram send to Ops error');
  }
}

/**
 * Send a Telegram message to the Watcher chat for a tenant (slot-check created, HTML diff, etc.).
 * Uses third chat ID from notify_settings.telegram_chat_ids (index 2: Watcher).
 * No-op if Telegram is disabled or Watcher chat not configured.
 */
export async function sendTelegramToWatcher(
  tenantId: string,
  text: string,
  logger: FastifyBaseLogger
): Promise<void> {
  const notifyRepo = new NotifyRepository(getDb());
  const settings = await notifyRepo.findByTenantId(tenantId);
  if (!settings?.telegram_enabled || !settings.telegram_bot_token) {
    logger.debug({ tenantId }, 'Telegram to Watcher skipped: disabled or not configured');
    return;
  }
  const chatIds = settings.telegram_chat_ids ?? [];
  if (chatIds.length < 3 || !chatIds[2]?.trim()) {
    logger.debug({ tenantId }, 'Telegram to Watcher skipped: no Watcher chat ID (set in Notifications → Watcher Chat ID)');
    return;
  }
  const entry = chatIds[2].trim();
  const [chatIdPart, threadIdStr] = entry.includes(':') ? entry.split(':') : [entry, ''];
  const chat_id = chatIdPart.trim();
  const message_thread_id = threadIdStr ? parseInt(threadIdStr, 10) : undefined;
  const payload: Record<string, unknown> = {
    chat_id,
    text,
    parse_mode: 'HTML',
  };
  if (message_thread_id != null && !Number.isNaN(message_thread_id)) {
    payload.message_thread_id = message_thread_id;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = (await res.json()) as { ok: boolean; description?: string };
    if (!result.ok) {
      logger.warn({ tenantId, err: result.description }, 'Telegram send to Watcher failed');
    }
  } catch (err) {
    logger.warn({ err, tenantId }, 'Telegram send to Watcher error');
  }
}
