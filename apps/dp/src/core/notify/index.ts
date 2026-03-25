import type { Logger } from 'pino';
import { createHmac } from 'crypto';
import { getDb, NotifyDedupeRepository } from '@visa-automation/db';
import { getConfigService } from '../../config/config-service.js';
import { getNotifySettings } from './notify-settings.js';
import { TELEGRAM_EMOJI } from './severity.js';
import { formatTimeTR, formatDateTimeTR, maskApplicant } from './format.js';
import { telegramSendMessage } from './telegram.js';
import { dedupeOnce } from './dedupe.js';
import { setSlotStatus } from './status.js';
import { sendEmail, resolveRecipient, smtpConfigFromNotifySettings, fetchBannerAttachment } from './email.js';
import { renderBookingConfirmedEmail, renderHitlRequiredEmail } from './templates/index.js';
import { getEventRouting } from './notify-settings.js';

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

/**
 * Build a signed HMAC token for the receipt PDF endpoint.
 * Must match the verification logic in apps/cp/src/routes/receipt.ts.
 */
function buildReceiptToken(jobId: string, type: 'customer' | 'ops'): string {
  const secret = process.env.RECEIPT_HMAC_SECRET ?? process.env.CP_JWT_SECRET ?? 'changeme';
  const payload = `${jobId}:${type}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/**
 * Fetches the receipt PDF from the CP internal API and returns it as an email attachment buffer.
 * Uses the internal CP_API_URL (Docker network) — not the public URL.
 */
async function fetchReceiptPdf(
  cpApiUrl: string,
  jobId: string,
  type: 'customer' | 'ops',
  logger?: Logger,
): Promise<Buffer | undefined> {
  try {
    const token = buildReceiptToken(jobId, type);
    const url = `${cpApiUrl.replace(/\/+$/, '')}/cp/jobs/${jobId}/receipt.pdf?type=${type}&token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      logger?.warn({ jobId, type, status: res.status, url }, 'Receipt PDF fetch returned non-OK, skipping attachment');
      return undefined;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    logger?.warn({ jobId, type, err: e }, 'Receipt PDF fetch failed, skipping attachment');
    return undefined;
  }
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
    args.logger.warn({ jobId: args.jobId }, 'notify_action_token not set or is default — ACK/STOP buttons will be omitted from Slot Open notification');
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
  const triggeredByName = (args.payload?.config as Record<string, unknown> | undefined)?.triggered_by_name as string | undefined;
  const triggeredByLine = triggeredByName
    ? `👤 ${triggeredByName}`
    : triggeredBy === 'manual' ? '👤 Manual' : triggeredBy === 'watcher_auto' ? '🤖 Auto' : undefined;
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
    const routing = getEventRouting(settings.notify_routing, 'slot_open');
    if (!routing.telegram) {
      args.logger.debug({ jobId: args.jobId }, 'SLOT FOUND: Telegram skipped by routing config');
    } else {
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
  }

  const smtp = smtpConfigFromNotifySettings(settings);
  if (smtp) {
    const routing = getEventRouting(settings.notify_routing, 'slot_open');
    if (routing.email) {
      // slot_open email is opt-in only (off by default via routing config)
      args.logger.debug({ jobId: args.jobId }, 'SLOT FOUND: email routing enabled, but no template — skipped');
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
  agentName?: string | null;
  jobStartMs?: number;
  jobEndMs?: number;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  // Skip cache so notify_routing / SMTP changes from Admin apply immediately (same as slot_open)
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret, { skipCache: true });
  const token = settings.telegram_bot_token;
  const { bookings: bookingsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  const bookingRouting = getEventRouting(settings.notify_routing, 'booking');

  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const actionToken = notifyConfig.notify_action_token ?? '';
  // Banner URL: served from CP static endpoint (internal Docker URL — only for fetching, not for img src)
  const bannerHttpUrl = cpApiUrl ? `${cpApiUrl.replace(/\/+$/, '')}/cp/static/banner-email.png` : undefined;

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

  // --- Telegram ---
  if (token && bookingsChatIds.length > 0 && bookingRouting.telegram) {
    const text =
      `<b>BOOKED</b> ${TELEGRAM_EMOJI.BOOKED}\n` +
      `Confirmation: <code>${args.confirmationNumber}</code>\n` +
      `Date/Time: ${bookedAt ? formatDateTimeTR(new Date(bookedAt)) : formatDateTimeTR()}\n` +
      `Applicant: ${applicantMasked}\n` +
      `Job: <code>${args.jobId}</code>`;
    const buttons =
      canUseTelegramActionButtons(actionBase) && actionToken && actionToken !== 'changeme'
        ? [{ text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=booked&token=${encodeURIComponent(actionToken)}` }]
        : undefined;
    await telegramSendMessage({ token, chatIds: bookingsChatIds, text, buttons, logger: args.logger });
  }

  // --- Ops/audit email ---
  const smtp = smtpConfigFromNotifySettings(settings);
  if (smtp && bookingRouting.email) {
    try {
      // Fetch banner once for both ops and customer emails
      const bannerResult = await fetchBannerAttachment(bannerHttpUrl, args.logger);
      const bannerCid = bannerResult ? `cid:${bannerResult.cid}` : undefined;

      // Fetch receipt PDF from CP (internal Docker URL) and attach to the email
      const opsPdfBuffer = await fetchReceiptPdf(cpApiUrl, args.jobId, 'ops', args.logger);

      // Ops/audit email always goes to the configured ops address (fallback_email or email_override),
      // never to the applicant. Customer gets a separate clean email below.
      const to = resolveRecipient(undefined, settings.fallback_email, settings.email_override);
      const email = renderBookingConfirmedEmail({
        jobId: args.jobId,
        tenantId: args.tenantId,
        portalId: args.portalId,
        portalLabel: args.portalLabel,
        baseUrl: args.baseUrl,
        confirmationNumber: args.confirmationNumber,
        bookedAt: bookedAt ? new Date(bookedAt) : new Date(),
        applicantMasked,
        applicantData: args.payload?.applicant_data as Record<string, unknown> | undefined,
        details: args.details,
        agentName: args.agentName,
        jobStartMs: args.jobStartMs,
        jobEndMs: args.jobEndMs,
        bannerUrl: bannerCid,
      });
      const opsAttachments = [
        ...(bannerResult ? [bannerResult.attachment] : []),
        ...(opsPdfBuffer ? [{ filename: `receipt-${args.jobId.slice(0, 8)}.pdf`, content: opsPdfBuffer }] : []),
      ];
      await sendEmail({
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        smtp,
        attachments: opsAttachments.length > 0 ? opsAttachments : undefined,
      });
      args.logger.info({ jobId: args.jobId, to }, 'Booking ops email sent');
    } catch (e) {
      args.logger.warn({ jobId: args.jobId, err: e }, 'Booking confirmation email failed');
    }
  }

  // --- Customer email (separate, clean version) ---
  if (smtp && settings.booking_send_to_customer) {
    const applicantEmail = args.payload?.applicant_data?.email;
    if (typeof applicantEmail === 'string' && applicantEmail.includes('@')) {
      try {
        const bannerResult = await fetchBannerAttachment(bannerHttpUrl, args.logger);
        const bannerCid = bannerResult ? `cid:${bannerResult.cid}` : undefined;
        const customerPdfBuffer = await fetchReceiptPdf(cpApiUrl, args.jobId, 'customer', args.logger);
        const customerEmail = renderBookingConfirmedEmail({
          jobId: args.jobId,
          tenantId: args.tenantId,
          portalId: args.portalId,
          portalLabel: args.portalLabel,
          baseUrl: args.baseUrl,
          confirmationNumber: args.confirmationNumber,
          bookedAt: bookedAt ? new Date(bookedAt) : new Date(),
          applicantMasked,
          applicantData: args.payload?.applicant_data as Record<string, unknown> | undefined,
          details: args.details,
          isCustomerEmail: true,
          bannerUrl: bannerCid,
        });
        const customerAttachments = [
          ...(bannerResult ? [bannerResult.attachment] : []),
          ...(customerPdfBuffer ? [{ filename: `appointment-receipt.pdf`, content: customerPdfBuffer }] : []),
        ];
        await sendEmail({
          to: applicantEmail,
          subject: customerEmail.subject,
          html: customerEmail.html,
          text: customerEmail.text,
          smtp,
          attachments: customerAttachments.length > 0 ? customerAttachments : undefined,
        });
        args.logger.info({ jobId: args.jobId, to: applicantEmail }, 'Booking customer email sent');
      } catch (e) {
        args.logger.warn({ jobId: args.jobId, err: e }, 'Booking customer email failed');
      }
    } else {
      args.logger.debug({ jobId: args.jobId }, 'booking_send_to_customer: no applicant email in payload, skipped');
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
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret, { skipCache: true });
  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const panelBase = process.env.HITL_PANEL_BASE_URL?.replace(/\/+$/, '') || actionBase;
  const panelUrl = `${panelBase}/hitl?job=${args.jobId}`;
  // Banner HTTP URL: internal Docker URL, fetched and embedded as CID attachment
  const bannerHttpUrl = cpApiUrl ? `${cpApiUrl.replace(/\/+$/, '')}/cp/static/banner-email.png` : undefined;

  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  const hitlRouting = getEventRouting(settings.notify_routing, 'hitl');
  if (token && opsChatIds.length > 0 && hitlRouting.telegram) {
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
  if (smtp && hitlRouting.email) {
    try {
      const to = resolveRecipient(undefined, settings.fallback_email, settings.email_override);
      const bannerResult = await fetchBannerAttachment(bannerHttpUrl, args.logger);
      const bannerCid = bannerResult ? `cid:${bannerResult.cid}` : undefined;
      const email = renderHitlRequiredEmail({
        jobId: args.jobId,
        hitlType: args.hitlType,
        expiresSeconds: args.expiresSeconds,
        panelUrl,
        bannerUrl: bannerCid,
      });
      await sendEmail({
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        smtp,
        attachments: bannerResult ? [bannerResult.attachment] : undefined,
      });
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
  triggeredByName?: string;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret, { skipCache: true });
  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (!token || opsChatIds.length === 0) return;
  if (!getEventRouting(settings.notify_routing, 'agent_start').telegram) return;

  const portalLine = args.portalLabel ? `${args.portalId} / ${args.portalLabel}` : args.portalId;
  const agentLine = args.agentName ?? args.agentId ?? '—';
  const triggeredByLine = args.triggeredByName
    ? `👤 ${args.triggeredByName}`
    : args.triggeredBy === 'manual' ? '👤 Manual' : args.triggeredBy === 'watcher_auto' ? '🤖 Auto' : undefined;
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
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret, { skipCache: true });
  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (!token || opsChatIds.length === 0) return;
  if (!getEventRouting(settings.notify_routing, 'agent_done').telegram) return;

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
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret, { skipCache: true });
  const token = settings.telegram_bot_token;
  const { ops: opsChatIds } = getOpsBookingsWatcherChatIds(settings.telegram_chat_ids ?? []);
  if (!token || opsChatIds.length === 0) return;
  if (!getEventRouting(settings.notify_routing, 'agent_fail').telegram) return;

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
