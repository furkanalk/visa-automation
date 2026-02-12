import type { FastifyPluginAsync } from 'fastify';
import { getDb, NotifyRepository } from '@visa-automation/db';
import type { UpdateNotifySettingsRequest, TestTelegramRequest, TestEmailRequest } from '@visa-automation/shared';

export const notifyRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const notifyRepo = new NotifyRepository(db);

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

    // Redact sensitive fields
    const safeSettings = {
      ...settings,
      telegram_bot_token: settings.telegram_bot_token ? '***REDACTED***' : null,
      smtp_pass: settings.smtp_pass ? '***REDACTED***' : null,
      webhook_secret: settings.webhook_secret ? '***REDACTED***' : null,
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

    const settings = await notifyRepo.upsert(request.tenantId, updates);

    // Redact sensitive fields
    const safeSettings = {
      ...settings,
      telegram_bot_token: settings.telegram_bot_token ? '***REDACTED***' : null,
      smtp_pass: settings.smtp_pass ? '***REDACTED***' : null,
      webhook_secret: settings.webhook_secret ? '***REDACTED***' : null,
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

    const chatId = request.body.chat_id ?? settings.telegram_chat_ids?.[0];
    if (!chatId) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_CHAT_ID',
          message: 'No chat_id provided and no default chat IDs configured',
        },
      });
    }

    try {
      // Send test message via Telegram API
      const message = request.body.message ?? '🔔 Test notification from Visa Automation Control Plane';
      
      const response = await fetch(
        `https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        }
      );

      const result = await response.json() as { ok: boolean; description?: string; result?: { message_id: number } };

      if (!result.ok) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'TELEGRAM_SEND_FAILED',
            message: result.description ?? 'Failed to send Telegram message',
          },
        });
      }

      return {
        success: true,
        data: {
          channel: 'telegram',
          message: 'Test message sent successfully',
          details: {
            chat_id: chatId,
            message_id: result.result?.message_id,
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
   */
  app.post<{ Body: TestEmailRequest }>('/test/email', async (request, reply) => {
    const settings = await notifyRepo.findByTenantId(request.tenantId);

    if (!settings?.email_enabled) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'EMAIL_DISABLED',
          message: 'Email notifications are disabled for this tenant',
        },
      });
    }

    if (!settings.smtp_host || !settings.smtp_from) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'EMAIL_NOT_CONFIGURED',
          message: 'SMTP settings are not fully configured',
        },
      });
    }

    const to = request.body.to ?? settings.fallback_email ?? settings.email_override;
    if (!to) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_RECIPIENT',
          message: 'No recipient email provided and no default/override email configured',
        },
      });
    }

    try {
      // For MVP, we'll use nodemailer if available
      // This is a simplified implementation
      const nodemailer = await import('nodemailer');
      
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port,
        secure: settings.smtp_secure,
        auth: settings.smtp_user && settings.smtp_pass ? {
          user: settings.smtp_user,
          pass: settings.smtp_pass,
        } : undefined,
      });

      const subject = request.body.subject ?? 'Test Email from Visa Automation';
      const body = request.body.body ?? 'This is a test email from the Control Plane.';

      const info = await transporter.sendMail({
        from: settings.smtp_from,
        to,
        subject,
        text: body,
        html: `<p>${body}</p>`,
      });

      return {
        success: true,
        data: {
          channel: 'email',
          message: 'Test email sent successfully',
          details: {
            to,
            message_id: info.messageId,
          },
        },
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to send test email');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'EMAIL_ERROR',
          message: (err as Error).message,
        },
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

      return {
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
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to send test webhook');
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
