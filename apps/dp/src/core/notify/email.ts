import type { Logger } from 'pino';
import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, NotifyDedupeRepository } from '@visa-automation/db';
import { NOTIFY_EMOJI } from './severity.js';
import { dedupeOnce } from './dedupe.js';
import { getNotifySettings } from './notify-settings.js';
import type { NotifySettingsFromCP } from './notify-settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolve banner relative to this file: apps/dp/dist/core/notify/ → apps/dp/
const BANNER_PATH = join(__dirname, '..', '..', '..', 'banner-email.png');

export interface SmtpConfig {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
  secure: boolean;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  /** CID for inline embedding (e.g. banner). Omit for regular file attachments. */
  cid?: string;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  smtp: SmtpConfig;
  attachments?: EmailAttachment[];
}): Promise<void> {
  const { smtp } = args;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  await transporter.sendMail({
    from: smtp.from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    ...(args.attachments && args.attachments.length > 0 ? { attachments: args.attachments } : {}),
  });
}

/**
 * Load the banner image from the local filesystem and return it as a CID attachment.
 * Returns undefined if the file is not found (email will still be sent without banner).
 * Mirrors the same approach used in the invite email (apps/cp/src/routes/auth.ts).
 */
export function loadBannerAttachment(): { attachment: EmailAttachment; cid: string } | undefined {
  try {
    return {
      cid: 'vizeself-banner',
      attachment: {
        filename: 'banner.png',
        content: readFileSync(BANNER_PATH),
        cid: 'vizeself-banner',
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * @deprecated Use loadBannerAttachment() instead.
 * Kept for any callers that still use the HTTP fetch path.
 */
export async function fetchBannerAttachment(
  bannerHttpUrl: string | undefined,
  logger?: { warn: (o: object, s: string) => void }
): Promise<{ attachment: EmailAttachment; cid: string } | undefined> {
  return loadBannerAttachment() ?? fetchBannerAttachmentHttp(bannerHttpUrl, logger);
}

async function fetchBannerAttachmentHttp(
  bannerHttpUrl: string | undefined,
  logger?: { warn: (o: object, s: string) => void }
): Promise<{ attachment: EmailAttachment; cid: string } | undefined> {
  if (!bannerHttpUrl) return undefined;
  try {
    const res = await fetch(bannerHttpUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      logger?.warn({ url: bannerHttpUrl, status: res.status }, 'Banner HTTP fetch returned non-OK, email will be sent without banner');
      return undefined;
    }
    const content = Buffer.from(await res.arrayBuffer());
    return { cid: 'vizeself-banner', attachment: { filename: 'banner.png', content, cid: 'vizeself-banner' } };
  } catch (err) {
    logger?.warn({ url: bannerHttpUrl, err }, 'Banner HTTP fetch failed, email will be sent without banner');
    return undefined;
  }
}

export function resolveRecipient(
  applicantEmail?: unknown,
  fallbackTo?: string | null,
  emailOverride?: string | null
): string {
  if (emailOverride && emailOverride.trim()) return emailOverride.trim();
  if (typeof applicantEmail === 'string' && applicantEmail.includes('@')) return applicantEmail;
  if (fallbackTo && fallbackTo.trim()) return fallbackTo.trim();
  throw new Error('No email recipient: set fallback_email or email_override in CP notify settings');
}

export function smtpConfigFromNotifySettings(s: NotifySettingsFromCP): SmtpConfig | null {
  if (!s.smtp_host || !s.smtp_from) return null;
  return {
    host: s.smtp_host,
    port: s.smtp_port,
    user: s.smtp_user,
    pass: s.smtp_pass,
    from: s.smtp_from,
    secure: s.smtp_secure,
  };
}

export async function notifyJobCompletedEmail(args: {
  jobId: string;
  jobRunId: string;
  tenantId: string;
  portalId: string;
  confirmationNumber?: string;
  logger: Logger;
}): Promise<void> {
  try {
    const first = await new NotifyDedupeRepository(getDb()).tryRecordSend(args.jobId, 'job_completed_email', 'done');
    if (!first) {
      args.logger.debug({ jobId: args.jobId }, 'Completion email deduped (DB)');
      return;
    }
  } catch (e) {
    const ok = await dedupeOnce({
      key: `notify:job_completed_email:${args.jobId}:${args.jobRunId}`,
      ttlSeconds: 24 * 3600,
    });
    if (!ok) return;
  }

  const cpApiUrl = process.env.CP_API_URL;
  const internalSecret = process.env.CP_INTERNAL_SECRET;
  if (!cpApiUrl || !internalSecret) {
    throw new Error('CP_API_URL and CP_INTERNAL_SECRET are required for notify. Set them in environment.');
  }
  const notifySettings = await getNotifySettings(cpApiUrl, args.tenantId, internalSecret);
  const smtp = smtpConfigFromNotifySettings(notifySettings);
  if (!smtp) {
    args.logger.debug({ jobId: args.jobId }, 'SMTP not configured, skip completion email');
    return;
  }

  const to = resolveRecipient(undefined, notifySettings.fallback_email, notifySettings.email_override);
  const subject = `${NOTIFY_EMOJI.BOOKED} Visa Automation: Job completed (${args.jobId})`;
  const text =
    `Job completed.\n\n` +
    `jobId: ${args.jobId}\n` +
    `tenantId: ${args.tenantId}\n` +
    `portalId: ${args.portalId}\n` +
    `confirmationNumber: ${args.confirmationNumber ?? '-'}\n`;

  await sendEmail({ to, subject, text, smtp });
  args.logger.info({ jobId: args.jobId, jobRunId: args.jobRunId, to }, 'Completion email sent');
}
