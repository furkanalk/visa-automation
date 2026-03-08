import { renderEmailLayout, detailTable, divider } from './layout.js';

/** Email subject: [HITL] Turnstile required — job <id> (expires 180s) */
export function renderHitlRequiredEmail(args: {
  jobId: string;
  hitlType: string;
  expiresSeconds: number;
  panelUrl: string;
  /** CP static base URL for the banner image. */
  bannerUrl?: string;
}) {
  const subject = `[HITL] ${args.hitlType} required — job ${args.jobId} (expires ${args.expiresSeconds}s)`;

  const bodyHtml =
    detailTable([
      { label: 'Type',    value: `<code style="background:#f1f5f9;border-radius:4px;padding:2px 6px;font-family:monospace;">${args.hitlType}</code>` },
      { label: 'Job',     value: `<code style="background:#f1f5f9;border-radius:4px;padding:2px 6px;font-family:monospace;">${args.jobId}</code>` },
      { label: 'Expires', value: `${args.expiresSeconds}s` },
    ]) +
    divider +
    `<table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);"><a href="${args.panelUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.1px;border-radius:10px;">Open HITL Panel →</a></td></tr></table>` +
    `<div style="height:16px;"></div>` +
    `<p style="margin:0;font-size:12px;color:#6366f1;word-break:break-all;font-family:'Courier New',monospace;background-color:#f8f7ff;border:1px solid #e0e7ff;border-radius:6px;padding:10px 12px;">${args.panelUrl}</p>`;

  const html = renderEmailLayout({
    bannerUrl: args.bannerUrl,
    iconEmoji: '🔐',
    iconBg: '#fef3c7',
    title: 'Human Input Required',
    subtitle: `Agent has paused and requires manual input. Please open the panel before the timeout expires.`,
    bodyHtml,
  });

  const text = [
    `HITL REQUIRED 🔐`,
    ``,
    `Type:    ${args.hitlType}`,
    `Job:     ${args.jobId}`,
    `Expires: ${args.expiresSeconds}s`,
    ``,
    `Open Panel: ${args.panelUrl}`,
  ].join('\n');

  return { subject, html, text };
}
