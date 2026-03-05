import type { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { getDb, StaffRepository, NotifyRepository, SystemSettingsRepository, TenantRepository } from '@visa-automation/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve banner relative to this file (apps/cp/src/routes/ → apps/cp/)
const BANNER_PATH = join(__dirname, '..', '..', 'banner-email.png');

const INVITE_EXPIRES_DAYS = 7;
const BCRYPT_ROUNDS = 10;

export const authRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const staffRepo = new StaffRepository(db);

  /**
   * Login with email + password
   * POST /cp/auth/login
   * Body: { email, password, tenant_id_or_slug? }
   * Returns: { staff (without password_hash), tenant_id }
   */
  app.post<{ Body: { email: string; password: string; tenant_id?: string } }>('/login', async (request, reply) => {
    const { email, password, tenant_id } = request.body ?? {};
    if (!email || !password) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'email and password are required' },
      });
    }

    // Resolve tenant
    let tenantId = tenant_id ?? 'default';
    const tenantRepo = new TenantRepository(db);
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(tenantId)) {
      const tenant = await tenantRepo.findBySlug(tenantId);
      if (!tenant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'TENANT_NOT_FOUND', message: `Tenant not found: ${tenantId}` },
        });
      }
      tenantId = tenant.id;
    }

    const staff = await staffRepo.findByEmail(tenantId, email.toLowerCase().trim());
    if (!staff) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    if (staff.status === 'suspended') {
      return reply.status(403).send({
        success: false,
        error: { code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended. Contact administrator for help.' },
      });
    }

    if (staff.status === 'pending') {
      return reply.status(403).send({
        success: false,
        error: { code: 'ACCOUNT_PENDING', message: 'Account not activated. Check your email for the invite link.' },
      });
    }

    if (!staff.password_hash) {
      return reply.status(403).send({
        success: false,
        error: { code: 'NO_PASSWORD', message: 'No password set. Check your email for the invite link.' },
      });
    }

    const valid = await bcrypt.compare(password, staff.password_hash);
    if (!valid) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    // Update last_active
    await staffRepo.updateLastActive(tenantId, staff.id).catch(() => {});

    const { password_hash: _pw, invite_token: _t, invite_token_expires_at: _e, ...safeStaff } = staff;
    return reply.send({
      success: true,
      data: { staff: safeStaff, tenant_id: tenantId },
    });
  });

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

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Administrator',
  admin: 'Administrator',
  staff: 'Staff Member',
};

export async function sendInviteEmail(
  app: { log: { info: (o: object, s: string) => void; error: (o: object, s: string) => void } },
  tenantId: string,
  to: string,
  name: string,
  inviteToken: string,
  role?: string
): Promise<boolean> {
  const roleLabel = ROLE_LABELS[role ?? ''] ?? (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Staff Member');
  const baseUrl = await new SystemSettingsRepository(getDb()).getString(
    null, 'general', 'admin_portal_url',
    process.env.ADMIN_PORTAL_URL ?? 'http://localhost:3000'
  );
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

    const subject = "You've been invited to Vizeself Manager";
    const text = [
      `Hello ${name},`,
      ``,
      `You have been invited to join the Vizeself Manager platform as ${roleLabel}.`,
      ``,
      `Activate your account by setting your password using the link below:`,
      ``,
      `  ${registerUrl}`,
      ``,
      `This invitation link will expire in ${INVITE_EXPIRES_DAYS} days.`,
      ``,
      `If you were not expecting this invitation, you can safely ignore this email.`,
      ``,
      `— The Vizeself Team`,
    ].join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Banner -->
          <tr>
            <td style="line-height:0;border-radius:16px 16px 0 0;overflow:hidden;">
              <img src="cid:vizeself-banner" width="560" alt="Vizeself" style="display:block;width:100%;max-width:560px;border-radius:16px 16px 0 0;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border-radius:0 0 16px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 16px rgba(0,0,0,0.06);overflow:hidden;">

              <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 40px 32px;">

                <!-- Icon -->
                <tr>
                  <td style="padding-bottom:24px;">
                    <div style="display:inline-block;background-color:#ede9fe;border-radius:50%;width:48px;height:48px;line-height:48px;text-align:center;font-size:22px;">✉️</div>
                  </td>
                </tr>

                <!-- Title -->
                <tr>
                  <td style="padding-bottom:8px;">
                    <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.4px;">You've been invited</h1>
                  </td>
                </tr>

                <!-- Subtitle -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">
                      Hello <strong style="color:#0f172a;">${name}</strong>, you have been invited to join <strong style="color:#0f172a;">Vizeself Manager</strong> as <strong style="color:#0f172a;">${roleLabel}</strong>. Set your password to activate your account.
                    </p>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td style="padding-bottom:32px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                          <a href="${registerUrl}"
                             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.1px;border-radius:10px;">
                            Activate My Account →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding-bottom:24px;">
                    <div style="height:1px;background-color:#f1f5f9;"></div>
                  </td>
                </tr>

                <!-- Link fallback -->
                <tr>
                  <td style="padding-bottom:6px;">
                    <p style="margin:0;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Or copy this link</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:12px;color:#6366f1;word-break:break-all;font-family:'Courier New',monospace;background-color:#f8f7ff;border:1px solid #e0e7ff;border-radius:6px;padding:10px 12px;">${registerUrl}</p>
                  </td>
                </tr>

                <!-- Expiry notice -->
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
                      <tr>
                        <td style="font-size:13px;color:#92400e;line-height:1.5;">
                          ⏳ &nbsp;This invitation link expires in <strong>${INVITE_EXPIRES_DAYS} days</strong>. If you did not expect this email, you can safely ignore it.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                This email was sent by <strong>Vizeself Manager</strong>.<br />
                If you have questions, contact your administrator.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    let bannerAttachment: { filename: string; content: Buffer; cid: string } | undefined;
    try {
      bannerAttachment = {
        filename: 'banner.png',
        content: readFileSync(BANNER_PATH),
        cid: 'vizeself-banner',
      };
    } catch {
      // Banner file not found — send email without image
    }

    await transporter.sendMail({
      from: settings.smtp_from,
      to: recipient,
      subject,
      text,
      html,
      ...(bannerAttachment ? { attachments: [bannerAttachment] } : {}),
    });
    app.log.info({ to: recipient }, 'Invite email sent');
    return true;
  } catch (err) {
    app.log.error({ err, to: recipient }, 'Failed to send invite email');
    return false;
  }
}

