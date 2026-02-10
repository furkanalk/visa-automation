import type { Logger } from 'pino';
import nodemailer from 'nodemailer';

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<void> {
  const host = mustEnv('SMTP_HOST');
  const port = parseInt(mustEnv('SMTP_PORT'), 10);
  const user = optEnv('SMTP_USER');
  const pass = optEnv('SMTP_PASS');
  const from = mustEnv('SMTP_FROM');

  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
}

export function resolveRecipient(applicantEmail?: unknown): string {
  const override = optEnv('NOTIFY_EMAIL_TO');
  if (override) return override;

  if (typeof applicantEmail === 'string' && applicantEmail.includes('@')) return applicantEmail;

  // fallback (ops inbox)
  return mustEnv('SMTP_FALLBACK_TO');
}

export async function notifyJobCompletedEmail(args: {
  jobId: string;
  tenantId: string;
  portalId: string;
  confirmationNumber?: string;
  logger: Logger;
}): Promise<void> {
  const to = resolveRecipient();

  const subject = `✅ Visa Automation: Job completed (${args.jobId})`;
  const text =
    `Job completed.\n\n` +
    `jobId: ${args.jobId}\n` +
    `tenantId: ${args.tenantId}\n` +
    `portalId: ${args.portalId}\n` +
    `confirmationNumber: ${args.confirmationNumber ?? '-'}\n`;

  await sendEmail({ to, subject, text });

  args.logger.info({ jobId: args.jobId, to }, 'Completion email sent');
}
