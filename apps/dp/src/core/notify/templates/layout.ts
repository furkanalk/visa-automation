/**
 * Shared professional email layout — mirrors the staff invite email design.
 * Uses the vizeself banner served from CP static endpoint.
 *
 * Pass `bannerUrl` as `${CP_API_URL}/cp/static/banner-email.png` (or ADMIN_PORTAL_URL equivalent).
 */

export interface EmailLayoutOptions {
  /** Public URL to the banner image. If omitted the banner row is skipped. */
  bannerUrl?: string;
  /** Emoji icon shown in the coloured circle at the top of the card. */
  iconEmoji: string;
  /** Background color of the icon circle (hex or CSS). Default: #ede9fe */
  iconBg?: string;
  /** Email card title */
  title: string;
  /** Optional subtitle paragraph below title */
  subtitle?: string;
  /** Main content HTML — goes inside the card body */
  bodyHtml: string;
  /** Optional footer note below the card */
  footerNote?: string;
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const bannerRow = opts.bannerUrl
    ? `
          <!-- Banner -->
          <tr>
            <td style="line-height:0;border-radius:16px 16px 0 0;overflow:hidden;">
              <img src="${opts.bannerUrl}" width="560" alt="Vizeself" style="display:block;width:100%;max-width:560px;border-radius:16px 16px 0 0;" />
            </td>
          </tr>`
    : '';

  const subtitleRow = opts.subtitle
    ? `
                <!-- Subtitle -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">${opts.subtitle}</p>
                  </td>
                </tr>`
    : '';

  const footerRow = opts.footerNote
    ? `
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">${opts.footerNote}</p>
            </td>
          </tr>`
    : `
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                Sent by <strong>Vizeself Manager</strong>. This is an automated notification.
              </p>
            </td>
          </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">${bannerRow}

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border-radius:${opts.bannerUrl ? '0 0 16px 16px' : '16px'};box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 16px rgba(0,0,0,0.06);overflow:hidden;">
              <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 40px 32px;">

                <!-- Icon -->
                <tr>
                  <td style="padding-bottom:24px;">
                    <div style="display:inline-block;background-color:${opts.iconBg ?? '#ede9fe'};border-radius:50%;width:48px;height:48px;line-height:48px;text-align:center;font-size:22px;">${opts.iconEmoji}</div>
                  </td>
                </tr>

                <!-- Title -->
                <tr>
                  <td style="padding-bottom:8px;">
                    <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.4px;">${opts.title}</h1>
                  </td>
                </tr>${subtitleRow}

                <!-- Body -->
                <tr>
                  <td>
                    ${opts.bodyHtml}
                  </td>
                </tr>

              </table>
            </td>
          </tr>${footerRow}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Reusable detail-row table for key/value pairs inside an email. */
export function detailTable(rows: { label: string; value: string }[]): string {
  const trs = rows.map(
    (r) =>
      `<tr>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#64748b;white-space:nowrap;vertical-align:top;">${r.label}</td>
        <td style="padding:8px 12px;font-size:13px;color:#0f172a;word-break:break-all;">${r.value}</td>
      </tr>`
  ).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">${trs}</table>`;
}

/** Highlight badge (coloured pill). */
export function badge(text: string, bg = '#dcfce7', color = '#166534'): string {
  return `<span style="display:inline-block;background-color:${bg};color:${color};font-size:12px;font-weight:700;letter-spacing:0.3px;padding:4px 10px;border-radius:99px;">${text}</span>`;
}

/** Divider line. */
export const divider = `<div style="height:1px;background-color:#f1f5f9;margin:24px 0;"></div>`;
