import type { FastifyPluginAsync } from 'fastify';
import { getDb, NotifyRepository } from '@visa-automation/db';
import type { UpdateNotifySettingsRequest, TestTelegramRequest, TestEmailRequest } from '@visa-automation/shared';

export const notifyRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const notifyRepo = new NotifyRepository(db);

  /**
   * Get full notification settings for DP worker (no redaction).
   * Requires X-Internal-Secret to match CP_INTERNAL_SECRET; x-tenant-id for tenant.
   * GET /cp/notify/worker
   */
  app.get('/worker', async (request, reply) => {
    const secret = request.headers['x-internal-secret'] as string | undefined;
    const expected = process.env.CP_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Internal-Secret' },
      });
    }
    let settings = await notifyRepo.findByTenantId(request.tenantId);
    if (!settings) {
      settings = await notifyRepo.create({ tenant_id: request.tenantId });
    }
    return { success: true, data: settings };
  });

  /**
   * Get notification settings
   * GET /cp/notify
   */
  app.get('/', async (request) => {
    let settings = await notifyRepo.findByTenantId(request.tenantId);

    // Create default settings if not exists
    if (!settings) {
      settings = await notifyRepo.create({
        tenant_id: request.tenantId,
      });
    }

    const isSuperAdmin = (request as { roles?: string[] }).roles?.includes('super_admin');
    const safeSettings = {
      ...settings,
      telegram_bot_token: settings.telegram_bot_token
        ? (isSuperAdmin ? settings.telegram_bot_token : '***REDACTED***')
        : null,
      smtp_pass: settings.smtp_pass
        ? (isSuperAdmin ? settings.smtp_pass : '***REDACTED***')
        : null,
      webhook_secret: settings.webhook_secret
        ? (isSuperAdmin ? settings.webhook_secret : '***REDACTED***')
        : null,
    };

    return {
      success: true,
      data: safeSettings,
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Update notification settings
   * PATCH /cp/notify
   */
  app.patch<{ Body: UpdateNotifySettingsRequest }>('/', async (request) => {
    const body = request.body;
    const updates: Record<string, unknown> = {};

    // Telegram settings
    if (body.telegram_enabled !== undefined) updates.telegram_enabled = body.telegram_enabled;
    if (body.telegram_bot_token !== undefined) updates.telegram_bot_token = body.telegram_bot_token;
    if (body.telegram_chat_ids !== undefined) updates.telegram_chat_ids = body.telegram_chat_ids;

    // Email settings
    if (body.email_enabled !== undefined) updates.email_enabled = body.email_enabled;
    if (body.smtp_host !== undefined) updates.smtp_host = body.smtp_host;
    if (body.smtp_port !== undefined) updates.smtp_port = body.smtp_port;
    if (body.smtp_user !== undefined) updates.smtp_user = body.smtp_user;
    if (body.smtp_pass !== undefined) updates.smtp_pass = body.smtp_pass;
    if (body.smtp_from !== undefined) updates.smtp_from = body.smtp_from;
    if (body.smtp_secure !== undefined) updates.smtp_secure = body.smtp_secure;
    if (body.fallback_email !== undefined) updates.fallback_email = body.fallback_email;
    if (body.email_override !== undefined) updates.email_override = body.email_override;

    // Webhook settings
    if (body.webhook_enabled !== undefined) updates.webhook_enabled = body.webhook_enabled;
    if (body.webhook_url !== undefined) updates.webhook_url = body.webhook_url;
    if (body.webhook_secret !== undefined) updates.webhook_secret = body.webhook_secret;

    // Routing
    if (body.notify_routing !== undefined) updates.notify_routing = body.notify_routing as Record<string, unknown>;
    if (body.booking_send_to_customer !== undefined) updates.booking_send_to_customer = body.booking_send_to_customer;

    const settings = await notifyRepo.upsert(request.tenantId, updates);

    const isSuperAdmin = (request as { roles?: string[] }).roles?.includes('super_admin');
    const safeSettings = {
      ...settings,
      telegram_bot_token: settings.telegram_bot_token
        ? (isSuperAdmin ? settings.telegram_bot_token : '***REDACTED***')
        : null,
      smtp_pass: settings.smtp_pass
        ? (isSuperAdmin ? settings.smtp_pass : '***REDACTED***')
        : null,
      webhook_secret: settings.webhook_secret
        ? (isSuperAdmin ? settings.webhook_secret : '***REDACTED***')
        : null,
    };

    return {
      success: true,
      data: safeSettings,
    };
  });

  /**
   * Test Telegram notification
   * POST /cp/notify/test/telegram
   */
  app.post<{ Body: TestTelegramRequest }>('/test/telegram', async (request, reply) => {
    const settings = await notifyRepo.findByTenantId(request.tenantId);

    if (!settings?.telegram_enabled) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'TELEGRAM_DISABLED',
          message: 'Telegram notifications are disabled for this tenant',
        },
      });
    }

    if (!settings.telegram_bot_token) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'TELEGRAM_NOT_CONFIGURED',
          message: 'Telegram bot token is not configured',
        },
      });
    }

    const chatIds = request.body.chat_id
      ? [request.body.chat_id]
      : (settings.telegram_chat_ids ?? []);
    if (chatIds.length === 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_CHAT_ID',
          message: 'No chat_id provided and no Ops/Bookings chat IDs configured. Save Ops and Bookings Chat IDs first.',
        },
      });
    }

    const defaultMessage = `🔔 <b>Visa Automation – Test</b>\n\nThis is a test from the Admin Portal.\nSent at: ${new Date().toISOString()}`;
    const message = request.body.message ?? defaultMessage;
    const token = settings.telegram_bot_token;

    try {
      const results: Array<{ chat_id: string; message_thread_id?: number; message_id?: number; error?: string }> = [];

      for (const entry of chatIds) {
        const [chatIdPart, threadIdStr] = entry.includes(':') ? entry.split(':') : [entry.trim(), ''];
        const chat_id = chatIdPart.trim();
        const message_thread_id = threadIdStr ? parseInt(threadIdStr, 10) : undefined;
        const payload: Record<string, unknown> = {
          chat_id,
          text: message,
          parse_mode: 'HTML',
        };
        if (message_thread_id != null && !Number.isNaN(message_thread_id)) {
          payload.message_thread_id = message_thread_id;
        }

        const response = await fetch(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );

        const result = await response.json() as { ok: boolean; description?: string; result?: { message_id: number } };

        if (result.ok) {
          results.push({
            chat_id: entry,
            ...(message_thread_id != null ? { message_thread_id } : {}),
            message_id: result.result?.message_id,
          });
        } else {
          results.push({
            chat_id: entry,
            ...(message_thread_id != null ? { message_thread_id } : {}),
            error: result.description ?? `HTTP ${response.status}`,
          });
        }
      }

      const failed = results.filter((r) => r.error);
      if (failed.length === results.length) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'TELEGRAM_SEND_FAILED',
            message: failed[0]?.error ?? 'Failed to send Telegram message',
          },
        });
      }

      return {
        success: true,
        data: {
          channel: 'telegram',
          message: 'Test message sent',
          details: {
            sent: results.filter((r) => !r.error).length,
            failed: failed.length,
            results,
          },
        },
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to send test Telegram message');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'TELEGRAM_ERROR',
          message: (err as Error).message,
        },
      });
    }
  });

  /**
   * Test Email notification
   * POST /cp/notify/test/email
   * Body may include smtp_* overrides (current form values) so test works before Save.
   */
  app.post<{ Body: TestEmailRequest }>('/test/email', async (request, reply) => {
    const body = request.body ?? {};
    const settings = await notifyRepo.findByTenantId(request.tenantId);

    const useOverrides = Boolean(body.smtp_host && body.smtp_from);
    const host = useOverrides ? body.smtp_host! : settings?.smtp_host;
    const from = useOverrides ? body.smtp_from! : settings?.smtp_from;
    const port = useOverrides && body.smtp_port != null ? body.smtp_port : (settings?.smtp_port ?? 587);
    const user = useOverrides ? body.smtp_user : settings?.smtp_user;
    const pass = useOverrides ? body.smtp_pass : settings?.smtp_pass;
    const secure = useOverrides && body.smtp_secure !== undefined ? body.smtp_secure : (settings?.smtp_secure ?? false);

    if (!useOverrides && !settings?.email_enabled) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'EMAIL_DISABLED',
          message: 'Email notifications are disabled. Enable Email (SMTP) and fill SMTP Host and From, then Save or Test.',
        },
      });
    }

    if (!host || !from) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'EMAIL_NOT_CONFIGURED',
          message: 'SMTP Host and From are required. Fill them in the form and click Save, or fill them and click Test to try without saving.',
        },
      });
    }

    const to = body.to ?? settings?.fallback_email ?? settings?.email_override ?? (useOverrides ? from : null);
    if (!to) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_RECIPIENT',
          message: 'No recipient email. Configure Fallback email and Save, or send "to" in the test request.',
        },
      });
    }

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
      });

      const subject = body.subject ?? 'Test Email from Visa Automation';
      const textBody = body.body ?? 'This is a test email from the Control Plane.';

      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text: textBody,
        html: `<p>${textBody}</p>`,
      });

      return reply.send({
        success: true,
        data: {
          channel: 'email',
          message: 'Test email sent successfully',
          details: {
            to,
            message_id: info.messageId,
          },
        },
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to send test email');
      if (reply.sent) return;
      const e = err as Error & { code?: string; response?: string };
      let message = e.message;
      if (e.code === 'EAUTH') {
        if (e.response?.includes('SmtpClientAuthentication is disabled')) {
          message =
            'SMTP authentication is disabled for this mailbox. For Microsoft 365 work accounts, enable "Authenticated SMTP" in the admin center (https://aka.ms/smtp_auth_disabled).';
        } else {
          message =
            'SMTP login failed. Personal Outlook: use Host smtp-mail.outlook.com, Port 587, STARTTLS (secure off). Work/Office 365: use smtp.office365.com and enable SMTP AUTH for the mailbox. For automation, Microsoft Graph + OAuth2 is more reliable than SMTP.';
        }
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'EMAIL_ERROR', message },
      });
    }
  });

  /**
   * Test webhook
   * POST /cp/notify/test/webhook
   */
  app.post<{ Body: { payload?: Record<string, unknown> } }>('/test/webhook', async (request, reply) => {
    const settings = await notifyRepo.findByTenantId(request.tenantId);

    if (!settings?.webhook_enabled) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'WEBHOOK_DISABLED',
          message: 'Webhook notifications are disabled for this tenant',
        },
      });
    }

    if (!settings.webhook_url) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'Webhook URL is not configured',
        },
      });
    }

    try {
      const payload = request.body.payload ?? {
        event: 'test',
        timestamp: new Date().toISOString(),
        message: 'Test webhook from Visa Automation Control Plane',
      };

      const response = await fetch(settings.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.webhook_secret && {
            'X-Webhook-Signature': `sha256=${Buffer.from(
              JSON.stringify(payload) + settings.webhook_secret
            ).toString('base64')}`,
          }),
        },
        body: JSON.stringify(payload),
      });

      return reply.send({
        success: true,
        data: {
          channel: 'webhook',
          message: 'Test webhook sent',
          details: {
            url: settings.webhook_url,
            status: response.status,
            ok: response.ok,
          },
        },
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to send test webhook');
      if (reply.sent) return;
      return reply.status(500).send({
        success: false,
        error: {
          code: 'WEBHOOK_ERROR',
          message: (err as Error).message,
        },
      });
    }
  });
};
