import type { Logger } from 'pino';
import { getDb, NotifyDedupeRepository } from '@visa-automation/db';
import { getConfigService } from '../../config/config-service.js';
import { getNotifySettings } from './notify-settings.js';
import { NOTIFY_EMOJI, TELEGRAM_EMOJI } from './severity.js';
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
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret);
  const notifyConfig = getConfigService().get('notify');
  const actionBase = (notifyConfig.notify_action_base_url ?? '').replace(/\/+$/, '');
  const actionToken = notifyConfig.notify_action_token ?? '';

  const token = settings.telegram_bot_token;
  const chatIds = settings.telegram_chat_ids ?? [];
  if (settings.telegram_enabled && (!token || chatIds.length === 0)) {
    throw new Error('Telegram enabled but telegram_bot_token or telegram_chat_ids missing in CP notify settings');
  }
  if (!actionToken || actionToken === 'changeme') {
    throw new Error('notify_action_token not set in CP system_settings (notify category)');
  }

  const now = new Date();
  const datesText = args.dates.slice(0, 10).join(', ');
  const portalLine = args.portalLabel ? `${args.portalId} / ${args.portalLabel}` : args.portalId;
  const next = args.nextStep ?? 'booking akışına geçiliyor';

  // DB dedupe: one send per (job_id, type, semantic_key)
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

  const text =
    `<b>SLOT OPEN</b> ${TELEGRAM_EMOJI.SLOT_OPEN}\n` +
    `Portal: <code>${portalLine}</code>\n` +
    `Tarihler: ${datesText}\n` +
    `Detect: ${formatTimeTR(now)} (TR)\n` +
    `Job: <code>${args.jobId}</code>\n` +
    `Next: ${next}`;

  if (token && chatIds.length > 0) {
    await telegramSendMessage({
      token,
      chatIds,
      text,
      buttons: [
        { text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=slot_open&token=${encodeURIComponent(actionToken)}` },
        { text: '🛑 STOP', url: `${actionBase}/api/jobs/${args.jobId}/stop?token=${encodeURIComponent(actionToken)}` },
      ],
      logger: args.logger,
    });
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

export async function notifySlotClosed(args: {
  jobId: string;
  jobRunId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  logger: Logger;
}): Promise<void> {
  const { cpApiUrl, tenantId, internalSecret } = getCpNotifyContext(args.tenantId);
  const settings = await getNotifySettings(cpApiUrl, tenantId, internalSecret);
  const token = settings.telegram_bot_token;
  const chatIds = settings.telegram_chat_ids ?? [];
  if (!token || chatIds.length === 0) return;

  const nowIso = new Date().toISOString();

  const text =
    `${NOTIFY_EMOJI.SLOT_CLOSED} <b>SLOT CLOSED</b>\n` +
    `• job: <code>${args.jobId}</code>\n` +
    `• portal: <code>${args.portalId}</code>\n` +
    `• tenant: <code>${args.tenantId}</code>\n` +
    `• time: <code>${nowIso}</code>\n` +
    `• url: ${args.baseUrl}`;

  try {
    const first = await notifyDedupe().tryRecordSend(args.jobId, 'slot_closed', 'closed');
    if (!first) return;
  } catch (e) {
    const isNew = await dedupeOnce({ key: `notify:slot_closed:${args.jobId}:${args.jobRunId}`, ttlSeconds: 1800 });
    if (!isNew) return;
  }

  await telegramSendMessage({ token, chatIds, text, logger: args.logger });
}

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
  const chatIds = settings.telegram_chat_ids ?? [];
  if (!token || chatIds.length === 0) return;

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
    `Tarih/Saat: ${bookedAt ? formatDateTimeTR(new Date(bookedAt)) : formatDateTimeTR()}\n` +
    `Applicant: ${applicantMasked}\n` +
    `Job: <code>${args.jobId}</code>`;

  await telegramSendMessage({
    token,
    chatIds,
    text,
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
  const chatIds = settings.telegram_chat_ids ?? [];
  if (token && chatIds.length > 0) {
    const text =
      `<b>HITL REQUIRED</b> ${TELEGRAM_EMOJI.HITL_REQUIRED}\n` +
      `Type: <code>${args.hitlType}</code>\n` +
      `Link: ${panelUrl}\n` +
      `Expires: ${args.expiresSeconds}s\n` +
      `Job: <code>${args.jobId}</code>`;
    await telegramSendMessage({ token, chatIds, text, logger: args.logger });
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
