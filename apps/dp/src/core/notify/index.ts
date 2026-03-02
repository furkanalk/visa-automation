import type { Logger } from 'pino';
import { getDb, NotifyDedupeRepository } from '@visa-automation/db';
import { getConfigService } from '../../config/config-service.js';
import { getNotifySettings } from './notify-settings.js';
import { TELEGRAM_EMOJI } from './severity.js';
import { formatTimeTR, formatDateTimeTR, maskApplicant } from './format.js';
import { telegramSendMessage } from './telegram.js';
import { dedupeOnce } from './dedupe.js';
import { setSlotStatus } from './status.js';
import { sendEmail, resolveRecipient, smtpConfigFromNotifySettings } from './email.js';
import { renderSlotOpenEmail, renderBookingConfirmedEmail, renderHitlRequiredEmail } from './templates/index.js';

function notifyDedupe(): NotifyDedupeRepository {
  return new NotifyDedupeRepository(getDb());
}

function getCpNotifyContext(tenantId: string) {
  const cpApiUrl = process.env.CP_API_URL;
  const internalSecret = process.env.CP_INTERNAL_SECRET;
  if (!cpApiUrl || !internalSecret) {
    throw new Error('CP_API_URL and CP_INTERNAL_SECRET are required for notify. Set them in environment.');
  }
  return { cpApiUrl, tenantId, internalSecret };
}

/** Split saved [Ops, Bookings, Watcher] chat IDs. Index 0 = Ops, 1 = Bookings, 2 = Watcher. */
function getOpsBookingsWatcherChatIds(telegramChatIds: string[]): { ops: string[]; bookings: string[]; watcher: string[] } {
  const ids = telegramChatIds ?? [];
  const ops = ids.length > 0 ? [ids[0]] : [];
  const bookings = ids.length >= 2 ? [ids[1]] : ops;
  const watcher = ids.length >= 3 && ids[2]?.trim() ? [ids[2].trim()] : [];
  return { ops, bookings, watcher };
}


/** Telegram only allows HTTPS, non-localhost URLs in inline keyboard buttons. */
function canUseTelegramActionButtons(actionBase: string): boolean {
  if (!actionBase) return false;
  try {
    const u = new URL(actionBase);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return false;
    return true;
  } catch {
    return false;
  }
}

export async function notifySlotFound(args: {
  jobId: string;
  jobRunId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  dates: string[];
  portalLabel?: string;
  nextStep?: string;
  payload?: import('@visa-automation/shared').JobQueuePayload;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  // Skip cache so we always use latest Watcher chat ID (admin may have just added it)
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret, { skipCache: true });
  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const actionToken = notifyConfig.notify_action_token ?? '';

  const token = settings.telegram_bot_token;
  const chatIds = settings.telegram_chat_ids ?? [];
  const { watcher: watcherChatIds } = getOpsBookingsWatcherChatIds(chatIds);
  // Prefer Watcher (3rd) chat; if missing, send to all configured chats so Watcher still gets it (same list as Test Telegram)
  const slotNotifyChatIds = watcherChatIds.length > 0 ? watcherChatIds : chatIds.filter((id) => (id ?? '').trim().length > 0);
  if (settings.telegram_enabled && token && slotNotifyChatIds.length === 0) {
    args.logger.info(
      { jobId: args.jobId, tenantId: args.tenantId, telegramChatIdsLength: chatIds.length },
      'SLOT FOUND: No Telegram chat IDs configured, skipping'
    );
  }
  if (!actionToken || actionToken === 'changeme') {
    throw new Error('notify_action_token not set in CP system_settings (notify category)');
  }

  const now = new Date();
  const datesText = args.dates.slice(0, 30).join(', ');
  const portalLine = args.portalLabel ? `${args.portalId} / ${args.portalLabel}` : args.portalId;
  const next = args.nextStep ?? 'proceeding to booking flow';

  // DB dedupe: one send per (job_id, type, semantic_key). Watcher creates a new job per run,
  // so each slot-check job can produce one slot_open notify when an agent runs it and finds slots.
  try {
    const first = await notifyDedupe().tryRecordSend(args.jobId, 'slot_open', datesText);
    if (!first) {
      args.logger.info({ jobId: args.jobId }, 'Deduped slot_open (DB)');
      return;
    }
  } catch (e) {
    args.logger.warn({ jobId: args.jobId, err: e }, 'Notify dedupe DB failed, using Redis');
    const first = await dedupeOnce({ key: `notify:slot_open:${args.jobId}:${args.jobRunId}:${datesText}`, ttlSeconds: 60 * 10 });
    if (!first) return;
  }

  // Track slot status
  await setSlotStatus(args.jobId, 'open');

  const triggeredBy = (args.payload?.config as Record<string, unknown> | undefined)?.triggered_by as string | undefined;
  const triggeredByLine = triggeredBy === 'manual' ? '👤 Manual' : triggeredBy === 'watcher_auto' ? '🤖 Auto' : undefined;
  const applicantMaskedSlot = maskApplicant(args.payload?.applicant_data as Record<string, unknown> | undefined);

  const text =
    `🔔 <b>SLOT FOUND</b> ${TELEGRAM_EMOJI.SLOT_OPEN}\n` +
    `\n` +
    `Portal: <code>${portalLine}</code>\n` +
    `Dates: ${datesText}\n` +
    `Detected: ${formatTimeTR(now)} (TR)\n` +
    `Job: <code>${args.jobId}</code>\n` +
    `Run: <code>${args.jobRunId}</code>\n` +
    (triggeredByLine ? `Triggered by: ${triggeredByLine}\n` : '') +
    (applicantMaskedSlot ? `Applicant: ${applicantMaskedSlot}\n` : '') +
    `Next: ${next}`;

  if (token && slotNotifyChatIds.length > 0) {
    args.logger.info(
      { jobId: args.jobId, chatCount: slotNotifyChatIds.length, watcherOnly: watcherChatIds.length > 0 },
      'SLOT FOUND: Sending Telegram (Watcher or all configured chats)'
    );
    const buttons = canUseTelegramActionButtons(actionBase)
      ? [
          { text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=slot_open&token=${encodeURIComponent(actionToken)}` },
          { text: '🛑 STOP', url: `${actionBase}/api/jobs/${args.jobId}/stop?token=${encodeURIComponent(actionToken)}` },
        ]
      : [];
    try {
      await telegramSendMessage({
        token,
        chatIds: slotNotifyChatIds,
        text,
        buttons: buttons.length > 0 ? buttons : undefined,
        logger: args.logger,
      });
    } catch (err) {
      args.logger.error(
        { jobId: args.jobId, err, chatCount: slotNotifyChatIds.length },
        'SLOT FOUND: Failed to send Telegram (check chat IDs and that bot is in those chats)'
      );
      throw err;
    }
  }

  const smtp = smtpConfigFromNotifySettings(settings);
  if (smtp) {
    try {
      const to = resolveRecipient(args.payload?.applicant_data?.email, settings.fallback_email, settings.email_override);
      const email = renderSlotOpenEmail({
        jobId: args.jobId,
        tenantId: args.tenantId,
        portalId: args.portalId,
        baseUrl: args.baseUrl,
        dates: args.dates,
        payload: args.payload,
      });
      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, smtp });
    } catch (e) {
      args.logger.warn({ jobId: args.jobId, err: e }, 'Slot open email failed');
    }
  }
}

export async function notifySlotClosed(_args: {
  jobId: string;
  jobRunId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  logger: Logger;
}): Promise<void> {
  // No longer sent to any Telegram channel (Ops = Agent started, HITL, Agent completed; Watcher = SLOT OPEN, HTML Drift)
}

/**
 * No longer sent: Bookings channel only gets BOOKED (user requested).
 */
export async function notifySlotFoundBookingsSummary(_args: {
  jobId: string;
  tenantId: string;
  portalId: string;
  logger: Logger;
}): Promise<void> {}

export async function notifyBookingConfirmed(args: {
  jobId: string;
  jobRunId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  confirmationNumber: string;
  portalLabel?: string;
  details?: Record<string, unknown>;
  payload?: import('@visa-automation/shared').JobQueuePayload;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret);
  const token = settings.telegram_bot_token;
  const { bookings: bookingsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (!token || bookingsChatIds.length === 0) return;

  try {
    const first = await notifyDedupe().tryRecordSend(args.jobId, 'booked', args.confirmationNumber);
    if (!first) {
      args.logger.debug({ jobId: args.jobId }, 'notifyBookingConfirmed deduped (DB)');
      return;
    }
  } catch (e) {
    const ok = await dedupeOnce({
      key: `notify:booked:${args.jobId}:${args.jobRunId}:${args.confirmationNumber}`,
      ttlSeconds: 24 * 3600,
    });
    if (!ok) return;
  }

  const bookedAt = (args.details?.appointmentDateTime as string) ?? (args.details?.dateTime as string);
  const applicantMasked = maskApplicant(args.payload?.applicant_data as Record<string, unknown> | undefined);

  const text =
    `<b>BOOKED</b> ${TELEGRAM_EMOJI.BOOKED}\n` +
    `Confirmation: <code>${args.confirmationNumber}</code>\n` +
    `Date/Time: ${bookedAt ? formatDateTimeTR(new Date(bookedAt)) : formatDateTimeTR()}\n` +
    `Applicant: ${applicantMasked}\n` +
    `Job: <code>${args.jobId}</code>`;

  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const actionToken = notifyConfig.notify_action_token ?? '';
  const buttons =
    canUseTelegramActionButtons(actionBase) && actionToken && actionToken !== 'changeme'
      ? [{ text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=booked&token=${encodeURIComponent(actionToken)}` }]
      : undefined;

  await telegramSendMessage({
    token,
    chatIds: bookingsChatIds,
    text,
    buttons,
    logger: args.logger,
  });

  const smtp = smtpConfigFromNotifySettings(settings);
  if (smtp) {
    try {
      const to = resolveRecipient(args.payload?.applicant_data?.email, settings.fallback_email, settings.email_override);
      const email = renderBookingConfirmedEmail({
        jobId: args.jobId,
        tenantId: args.tenantId,
        portalId: args.portalId,
        portalLabel: args.portalLabel,
        baseUrl: args.baseUrl,
        confirmationNumber: args.confirmationNumber,
        bookedAt: bookedAt ? new Date(bookedAt) : new Date(),
        applicantMasked,
        details: args.details,
      });
      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, smtp });
    } catch (e) {
      args.logger.warn({ jobId: args.jobId, err: e }, 'Booking confirmation email failed');
    }
  }
}

/** HITL REQUIRED: Telegram + optional email (audit). Panel URL from notify_action_base_url. */
export async function notifyHitlRequired(args: {
  jobId: string;
  hitlType: string;
  taskId?: string;
  expiresSeconds: number;
  tenantId: string;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret);
  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const panelBase = process.env.HITL_PANEL_BASE_URL?.replace(/\/+$/, '') || actionBase;
  const panelUrl = `${panelBase}/hitl?job=${args.jobId}`;

  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (token && opsChatIds.length > 0) {
    const text =
      `<b>HITL REQUIRED</b> ${TELEGRAM_EMOJI.HITL_REQUIRED}\n` +
      `Type: <code>${args.hitlType}</code>\n` +
      `Link: ${panelUrl}\n` +
      `Expires: ${args.expiresSeconds}s\n` +
      `Job: <code>${args.jobId}</code>`;
    const notifyConfig = getConfigService().get('notify');
    const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
    const actionToken = notifyConfig.notify_action_token ?? '';
    const buttons =
      canUseTelegramActionButtons(actionBase) && actionToken && actionToken !== 'changeme'
        ? [
            { text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=hitl_required&token=${encodeURIComponent(actionToken)}` },
            { text: '🔧 Open Panel', url: panelUrl },
          ]
        : undefined;
    await telegramSendMessage({ token, chatIds: opsChatIds, text, buttons, logger: args.logger });
  }

  const smtp = smtpConfigFromNotifySettings(settings);
  if (smtp) {
    try {
      const to = resolveRecipient(undefined, settings.fallback_email, settings.email_override);
      const email = renderHitlRequiredEmail({
        jobId: args.jobId,
        hitlType: args.hitlType,
        expiresSeconds: args.expiresSeconds,
        panelUrl,
      });
      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text, smtp });
    } catch (e) {
      args.logger.warn({ jobId: args.jobId, err: e }, 'HITL required email failed');
    }
  }
}

/** Ops only: Agent started (detailed). All notifications in English with emojis. */
export async function notifyAgentStarted(args: {
  jobId: string;
  jobRunId: string;
  tenantId: string;
  portalId: string;
  portalLabel?: string;
  agentId: string | null;
  agentName: string | null;
  visaType?: string;
  priority?: number;
  triggeredBy?: string;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret);
  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (!token || opsChatIds.length === 0) return;

  const portalLine = args.portalLabel ? `${args.portalId} / ${args.portalLabel}` : args.portalId;
  const agentLine = args.agentName ?? args.agentId ?? '—';
  const triggeredByLine = args.triggeredBy === 'manual' ? '👤 Manual' : args.triggeredBy === 'watcher_auto' ? '🤖 Auto' : undefined;
  const lines = [
    '🚀 Agent Started',
    '',
    `Job: <code>${args.jobId}</code>`,
    `Run: <code>${args.jobRunId}</code>`,
    `Portal: ${portalLine}`,
    `Agent: ${agentLine}`,
  ];
  if (args.visaType != null) lines.push(`Visa: ${args.visaType}`);
  if (args.priority != null) lines.push(`Priority: ${args.priority}`);
  if (triggeredByLine) lines.push(`Triggered by: ${triggeredByLine}`);
  const text = lines.join('\n');

  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const actionToken = notifyConfig.notify_action_token ?? '';
  const buttons =
    canUseTelegramActionButtons(actionBase) && actionToken && actionToken !== 'changeme'
      ? [{ text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=agent_started&token=${encodeURIComponent(actionToken)}` }]
      : undefined;

  await telegramSendMessage({ token, chatIds: opsChatIds, text, buttons, logger: args.logger });
}

/** Ops only: Agent completed (success path). English, no MVP in messages. */
export async function notifyAgentCompleted(args: {
  jobId: string;
  jobRunId: string;
  tenantId: string;
  portalId: string;
  portalLabel?: string;
  agentId: string | null;
  agentName: string | null;
  status: 'completed' | 'cancelled' | 'slot_found' | 'no_slot_completed' | 'waiting_hitl' | 'waiting_slot';
  details?: string;
  confirmationNumber?: string;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret);
  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (!token || opsChatIds.length === 0) return;

  const portalLine = args.portalLabel ? `${args.portalId} / ${args.portalLabel}` : args.portalId;
  const agentLine = args.agentName ?? args.agentId ?? '—';
  const title =
    args.status === 'slot_found'
      ? '✅ Agent Completed (Slot Found)'
      : args.status === 'no_slot_completed'
        ? '✅ Agent Completed (No Slot)'
        : '✅ Agent Completed';
  const finalStatus =
    args.status === 'slot_found' ? 'SLOT_FOUND' : args.status === 'no_slot_completed' ? 'COMPLETED' : args.status.toUpperCase();
  const lines = [
    title,
    '',
    `Job: <code>${args.jobId}</code>`,
    `Run: <code>${args.jobRunId}</code>`,
    `Portal: ${portalLine}`,
    `Agent: ${agentLine}`,
    `Final Status: ${finalStatus}`,
  ];
  if (args.confirmationNumber) lines.push(`Confirmation: ${args.confirmationNumber}`);
  const cleanDetails = args.details?.replace(/\s*\(MVP\)\s*/gi, '').trim();
  if (cleanDetails) lines.push(cleanDetails);
  const text = lines.join('\n');

  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const actionToken = notifyConfig.notify_action_token ?? '';
  const buttons =
    canUseTelegramActionButtons(actionBase) && actionToken && actionToken !== 'changeme'
      ? [{ text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=agent_completed&token=${encodeURIComponent(actionToken)}` }]
      : undefined;

  await telegramSendMessage({ token, chatIds: opsChatIds, text, buttons, logger: args.logger });
}

/** Ops only: Agent failed (FAILED_RETRYABLE, FAILED_TERMINAL, etc.). */
export async function notifyAgentFailed(args: {
  jobId: string;
  jobRunId: string;
  tenantId: string;
  portalId: string;
  portalLabel?: string;
  agentId: string | null;
  agentName: string | null;
  finalStatus: string;
  reason: string;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret);
  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (!token || opsChatIds.length === 0) return;

  const portalLine = args.portalLabel ? `${args.portalId} / ${args.portalLabel}` : args.portalId;
  const agentLine = args.agentName ?? args.agentId ?? '—';
  const text =
    '❌ Agent Failed\n' +
    '\n' +
    `Job: <code>${args.jobId}</code>\n` +
    `Run: <code>${args.jobRunId}</code>\n` +
    `Portal: ${portalLine}\n` +
    `Agent: ${agentLine}\n` +
    `Final Status: ${args.finalStatus}\n` +
    `Reason: ${args.reason}`;

  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const actionToken = notifyConfig.notify_action_token ?? '';
  const buttons =
    canUseTelegramActionButtons(actionBase) && actionToken && actionToken !== 'changeme'
      ? [{ text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=agent_failed&token=${encodeURIComponent(actionToken)}` }]
      : undefined;

  await telegramSendMessage({ token, chatIds: opsChatIds, text, buttons, logger: args.logger });
}
