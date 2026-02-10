import type { Logger } from 'pino';
import { telegramSendMessage } from './telegram.js';
import { dedupeOnce } from './dedupe.js';
import { setSlotStatus } from './status.js';
import { sendEmail, resolveRecipient } from './email.js';
import { renderSlotOpenEmail, renderBookingConfirmedEmail } from './templates/index.js';

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function splitCsv(x: string): string[] {
  return x
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function notifySlotFound(args: {
  jobId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  dates: string[];
  payload?: import('@visa-automation/shared').JobQueuePayload;
  logger: Logger;
}): Promise<void> {
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const chatIds = splitCsv(mustEnv('TELEGRAM_CHAT_IDS'));
  const actionBase = mustEnv('NOTIFY_ACTION_BASE_URL').replace(/\/+$/, '');
  const actionToken = mustEnv('NOTIFY_ACTION_TOKEN');

  const nowIso = new Date().toISOString();
  const datesText = args.dates.slice(0, 10).join(', ');

  const dedupeKey = `notify:slot_open:${args.tenantId}:${args.jobId}:${datesText}`;
  const first = await dedupeOnce({ key: dedupeKey, ttlSeconds: 60 * 10 }); // 10 dk
  if (!first) {
    args.logger.info({ jobId: args.jobId }, 'Deduped slot_open notification');
    return;
  }

  // Track slot status
  await setSlotStatus(args.jobId, 'open');

  const text =
    `🟢 <b>SLOT OPEN</b>\n` +
    `• job: <code>${args.jobId}</code>\n` +
    `• portal: <code>${args.portalId}</code>\n` +
    `• tenant: <code>${args.tenantId}</code>\n` +
    `• time: <code>${nowIso}</code>\n` +
    `• dates: <code>${datesText}</code>\n` +
    `• url: ${args.baseUrl}`;

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

  // Email (summary) - optional if SMTP not configured
  if (process.env.SMTP_HOST) {
    try {
      const to = resolveRecipient(args.payload?.applicant_data?.email);
      const email = renderSlotOpenEmail({
        jobId: args.jobId,
        tenantId: args.tenantId,
        portalId: args.portalId,
        baseUrl: args.baseUrl,
        dates: args.dates,
        payload: args.payload,
      });
      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
    } catch (e) {
      args.logger.warn({ jobId: args.jobId, err: e }, 'Slot open email failed');
    }
  }
}

export async function notifySlotClosed(args: {
  jobId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  logger: Logger;
}): Promise<void> {
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const chatIds = splitCsv(mustEnv('TELEGRAM_CHAT_IDS'));

  const nowIso = new Date().toISOString();

  const text =
    `🔴 <b>SLOT CLOSED</b>\n` +
    `• job: <code>${args.jobId}</code>\n` +
    `• portal: <code>${args.portalId}</code>\n` +
    `• tenant: <code>${args.tenantId}</code>\n` +
    `• time: <code>${nowIso}</code>\n` +
    `• url: ${args.baseUrl}`;

  // 30 dk dedupe: aynı "kapandı" spam olmasın
  const isNew = await dedupeOnce({ key: `slot_closed:${args.jobId}`, ttlSeconds: 1800 });
  if (!isNew) return;

  await telegramSendMessage({ token, chatIds, text, logger: args.logger });
}

export async function notifyBookingConfirmed(args: {
  jobId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  confirmationNumber: string;
  details?: Record<string, unknown>;
  payload?: import('@visa-automation/shared').JobQueuePayload;
  logger: Logger;
}): Promise<void> {
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const chatIds = splitCsv(mustEnv('TELEGRAM_CHAT_IDS'));

  const ok = await dedupeOnce({
    key: `notify:booked:${args.jobId}:${args.confirmationNumber}`,
    ttlSeconds: 24 * 3600,
  });
  if (!ok) {
    args.logger.debug({ jobId: args.jobId }, 'notifyBookingConfirmed deduped');
    return;
  }

  // Telegram (light)
  const text =
    `✅ <b>BOOKED</b>\n` +
    `• job: <code>${args.jobId}</code>\n` +
    `• portal: <code>${args.portalId}</code>\n` +
    `• confirmation: <code>${args.confirmationNumber}</code>\n` +
    `• url: ${args.baseUrl}`;

  await telegramSendMessage({
    token,
    chatIds,
    text,
    logger: args.logger,
  });

  // Email (heavy) - optional if SMTP not configured
  if (process.env.SMTP_HOST) {
    try {
      const to = resolveRecipient(args.payload?.applicant_data?.email);
      const email = renderBookingConfirmedEmail({
        jobId: args.jobId,
        tenantId: args.tenantId,
        portalId: args.portalId,
        baseUrl: args.baseUrl,
        confirmationNumber: args.confirmationNumber,
        details: args.details,
      });

      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
    } catch (e) {
      args.logger.warn({ jobId: args.jobId, err: e }, 'Booking confirmation email failed');
    }
  }
}
