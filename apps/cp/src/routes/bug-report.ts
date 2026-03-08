import type { FastifyPluginAsync } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb, NotifyRepository } from '@visa-automation/db';

const execFileAsync = promisify(execFile);

interface BugReportBody {
  title: string;
  description: string;
  timeWindowMinutes: number; // 2, 5, 10, 30, 60
  /** base64-encoded attachment (optional) */
  attachmentBase64?: string;
  attachmentName?: string;
  attachmentMime?: string;
}

const CONTAINERS = ['visa-cp', 'visa-dp', 'visa-admin-portal', 'visa-mock-portal'];

async function fetchContainerLogs(container: string, sinceSeconds: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync('docker', [
      'logs',
      '--since', `${sinceSeconds}s`,
      '--timestamps',
      container,
    ], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    return stdout || '(no output)';
  } catch (err: any) {
    // stderr is where docker logs writes by default
    if (err.stderr && err.stderr.trim()) return err.stderr.trim();
    return `(failed to fetch: ${(err as Error).message})`;
  }
}

function buildHtmlEmail(opts: {
  title: string;
  description: string;
  timeWindowLabel: string;
  logs: Record<string, string>;
  reportedAt: string;
  tenantId: string;
}): string {
  const { title, description, timeWindowLabel, logs, reportedAt, tenantId } = opts;

  const logSections = Object.entries(logs)
    .map(
      ([container, log]) => `
      <div style="margin-bottom:24px;">
        <div style="background:#1e293b;color:#94a3b8;font-size:11px;font-family:monospace;padding:6px 12px;border-radius:6px 6px 0 0;letter-spacing:.05em;">
          📦 ${container}
        </div>
        <pre style="margin:0;padding:12px;background:#0f172a;color:#e2e8f0;font-size:11px;font-family:'Courier New',monospace;border-radius:0 0 6px 6px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto;">${escapeHtml(log)}</pre>
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Bug Report — ${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:12px 12px 0 0;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="font-size:13px;color:#64748b;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Vizeself Manager</div>
                    <div style="font-size:22px;font-weight:700;color:#f8fafc;line-height:1.3;">🐛 ${escapeHtml(title)}</div>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <span style="display:inline-block;background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;letter-spacing:.05em;">BUG REPORT</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Meta bar -->
          <tr>
            <td style="background:#1e3a5f;padding:10px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#93c5fd;font-size:12px;">
                    🕐 <strong>Reported at:</strong> ${escapeHtml(reportedAt)}
                  </td>
                  <td align="right" style="color:#93c5fd;font-size:12px;">
                    🔍 <strong>Logs:</strong> last ${escapeHtml(timeWindowLabel)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#fff;padding:28px 32px;">

              <!-- Description -->
              <div style="margin-bottom:24px;">
                <div style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">📝 Description</div>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap;">${escapeHtml(description)}</div>
              </div>

              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

              <!-- Logs -->
              <div>
                <div style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:16px;">📋 Container Logs (last ${escapeHtml(timeWindowLabel)})</div>
                ${logSections}
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;padding:16px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:11px;color:#94a3b8;">
                    Tenant: <code style="background:#e2e8f0;padding:1px 5px;border-radius:3px;">${escapeHtml(tenantId)}</code>
                  </td>
                  <td align="right" style="font-size:11px;color:#94a3b8;">
                    Vizeself Manager — Automated Bug Report
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function timeLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes / 60} hour${minutes / 60 === 1 ? '' : 's'}`;
}

export const bugReportRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /cp/bug-report
   * Collects container logs for the given time window and sends an email.
   */
  app.post<{ Body: BugReportBody }>('/', async (request, reply) => {
    const { title, description, timeWindowMinutes = 10, attachmentBase64, attachmentName, attachmentMime } = request.body ?? {};

    if (!title?.trim() || !description?.trim()) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'title and description are required' },
      });
    }

    const db = getDb();
    const notifyRepo = new NotifyRepository(db);
    const settings = await notifyRepo.findByTenantId(request.tenantId);

    if (!settings?.smtp_host || !settings?.smtp_from) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'SMTP_NOT_CONFIGURED',
          message: 'SMTP is not configured. Set SMTP host/from in Notifications settings first.',
        },
      });
    }

    const to = 'visorhq.notify@outlook.com';
    const sinceSeconds = timeWindowMinutes * 60;
    const reportedAt = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour12: false });

    // Fetch logs from all containers in parallel
    const logResults = await Promise.all(
      CONTAINERS.map(async (c) => ({ container: c, log: await fetchContainerLogs(c, sinceSeconds) }))
    );
    const logs: Record<string, string> = {};
    for (const { container, log } of logResults) {
      logs[container] = log;
    }

    const html = buildHtmlEmail({
      title: title.trim(),
      description: description.trim(),
      timeWindowLabel: timeLabel(timeWindowMinutes),
      logs,
      reportedAt,
      tenantId: request.tenantId,
    });

    // Plain text fallback
    const text = [
      `BUG REPORT — ${title.trim()}`,
      `Reported at: ${reportedAt}`,
      `Log window: last ${timeLabel(timeWindowMinutes)}`,
      '',
      '=== Description ===',
      description.trim(),
      '',
      ...CONTAINERS.map((c) => `=== ${c} ===\n${logs[c]}`),
    ].join('\n');

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port ?? 587,
        secure: settings.smtp_secure ?? false,
        auth: settings.smtp_user && settings.smtp_pass
          ? { user: settings.smtp_user, pass: settings.smtp_pass }
          : undefined,
      });

      const attachments: object[] = [];
      if (attachmentBase64 && attachmentName) {
        attachments.push({
          filename: attachmentName,
          content: Buffer.from(attachmentBase64, 'base64'),
          contentType: attachmentMime ?? 'application/octet-stream',
        });
      }

      await transporter.sendMail({
        from: settings.smtp_from,
        to,
        subject: `🐛 Bug Report: ${title.trim()}`,
        text,
        html,
        attachments,
      });

      return { success: true, data: { sent_to: to } };
    } catch (err) {
      request.log.error({ err }, 'Failed to send bug report email');
      return reply.status(500).send({
        success: false,
        error: { code: 'EMAIL_ERROR', message: (err as Error).message },
      });
    }
  });
};
