import type { Logger } from 'pino';
import { createHmac, randomUUID } from 'node:crypto';
import { telegramSendMessage } from './telegram.js';

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
  logger: Logger;
}): Promise<void> {
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const chatIds = splitCsv(mustEnv('TELEGRAM_CHAT_IDS'));
  const actionBase = mustEnv('NOTIFY_ACTION_BASE_URL').replace(/\/+$/, '');
  const secret = mustEnv('NOTIFY_ACTION_SECRET');

  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const sign = (action: string) =>
    createHmac('sha256', secret)
      .update(`${args.jobId}.${action}.${ts}.${nonce}`)
      .digest('base64url');

  const nowIso = new Date().toISOString();
  const datesText = args.dates.slice(0, 10).join(', ');

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
      { text: '✅ ACK', url: `${actionBase}/api/jobs/${args.jobId}/ack?event=slot_open&ts=${ts}&nonce=${nonce}&sig=${sign('ack')}` },
      { text: '🛑 STOP', url: `${actionBase}/api/jobs/${args.jobId}/stop?ts=${ts}&nonce=${nonce}&sig=${sign('stop')}` },
    ],
    logger: args.logger,
  });
}

