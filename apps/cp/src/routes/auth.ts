import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import { getDb, StaffRepository, NotifyRepository } from '@visa-automation/db';

const INVITE_EXPIRES_DAYS = 7;
const BCRYPT_ROUNDS = 10;

export const authRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const staffRepo = new StaffRepository(db);
  const notifyRepo = new NotifyRepository(db);

  /**
   * Get invite details by token (for register page)
   * GET /cp/auth/invite/:token
   */
  app.get<{ Params: { token: string } }>('/invite/:token', async (request, reply) => {
    const staff = await staffRepo.findByInviteToken(request.params.token);
    if (!staff) {
      return reply.status(404).send({
        success: false,
        error: { code: 'INVITE_INVALID', message: 'Invite link is invalid or expired' },
      });
    }
    return {
      success: true,
      data: { email: staff.email, name: staff.name },
    };
  });

  /**
   * Complete registration: set password with invite token
   * POST /cp/auth/complete-registration
   */
  app.post<{ Body: { token: string; password: string } }>('/complete-registration', async (request, reply) => {
    const { token, password } = request.body ?? {};
    if (!token || typeof password !== 'string' || password.length < 8) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'token and password (min 8 characters) are required',
        },
      });
    }

    const staff = await staffRepo.findByInviteToken(token);
    if (!staff) {
      return reply.status(404).send({
        success: false,
        error: { code: 'INVITE_INVALID', message: 'Invite link is invalid or expired' },
      });
    }

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const updated = await staffRepo.update(staff.tenant_id, staff.id, {
      password_hash,
      status: 'active',
      invite_token: null,
      invite_token_expires_at: null,
    });

    if (!updated) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to complete registration' },
      });
    }

    const { password_hash: _pw, invite_token: _t, invite_token_expires_at: _e, ...rest } = updated;
    return {
      success: true,
      data: { message: 'Registration complete. You can now sign in.', staff: rest },
    };
  });
};

export async function sendInviteEmail(
  app: { log: { info: (o: object, s: string) => void; error: (o: object, s: string) => void } },
  tenantId: string,
  to: string,
  name: string,
  inviteToken: string
): Promise<boolean> {
  const baseUrl = process.env.ADMIN_PORTAL_URL ?? process.env.CP_PUBLIC_URL ?? 'http://localhost:3000';
  const registerUrl = `${baseUrl.replace(/\/$/, '')}/register?token=${inviteToken}`;

  const notifyRepo = new NotifyRepository(getDb());
  const settings = await notifyRepo.findByTenantId(tenantId);
  if (!settings?.email_enabled || !settings.smtp_host || !settings.smtp_from) {
    const missing = [
      !settings?.email_enabled && 'email_enabled',
      !settings?.smtp_host && 'smtp_host',
      !settings?.smtp_from && 'smtp_from',
    ].filter(Boolean);
    app.log.info(
      { tenantId, to, missing },
      'Invite email skipped: configure Notifications → Email (SMTP): enable email, set SMTP host and From address'
    );
    return false;
  }

  // Invite must go to the staff member's email so they can click the link; never override.
  const recipient = (to || '').trim();
  if (!recipient) {
    app.log.info({ tenantId }, 'Invite email skipped: no recipient');
    return false;
  }

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: settings.smtp_port,
      secure: settings.smtp_secure,
      auth: settings.smtp_user && settings.smtp_pass
        ? { user: settings.smtp_user, pass: settings.smtp_pass }
        : undefined,
    });

    const subject = 'Complete your staff account – Visor Manager';
    const text = `Hello ${name},\n\nYou have been invited to join the staff. Set your password to activate your account:\n\n${registerUrl}\n\nThis link expires in ${INVITE_EXPIRES_DAYS} days.\n\nIf you did not expect this email, you can ignore it.`;
    const html = `<p>Hello ${name},</p><p>You have been invited to join the staff. <a href="${registerUrl}">Set your password</a> to activate your account.</p><p>This link expires in ${INVITE_EXPIRES_DAYS} days.</p><p>If you did not expect this email, you can ignore it.</p>`;

    await transporter.sendMail({
      from: settings.smtp_from,
      to: recipient,
      subject,
      text,
      html,
    });
    app.log.info({ to: recipient }, 'Invite email sent');
    return true;
  } catch (err) {
    app.log.error({ err, to: recipient }, 'Failed to send invite email');
    return false;
  }
}

