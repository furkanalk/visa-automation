import { formatDateTimeTR } from '../format.js';
import { renderEmailLayout, detailTable, badge, divider } from './layout.js';

function escapeHtml(s: string): string {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderBookingConfirmedEmail(args: {
  jobId: string;
  tenantId: string;
  portalId: string;
  portalLabel?: string;
  baseUrl: string;
  confirmationNumber: string;
  bookedAt: Date;
  applicantMasked: string;
  details?: Record<string, unknown>;
  /** If true, email is addressed to the customer (no job/tenant IDs shown). */
  isCustomerEmail?: boolean;
  /** CP static base URL for the banner image e.g. https://api.vizeself.com */
  bannerUrl?: string;
}) {
  const portalTitle = args.portalLabel ?? args.portalId;
  const dateTimeStr = formatDateTimeTR(args.bookedAt);
  const subject = args.isCustomerEmail
    ? `✅ Your Appointment is Confirmed — ${portalTitle}`
    : `[BOOKED] ${portalTitle} — ${dateTimeStr} — #${args.confirmationNumber}`;

  const opsRows = [
    { label: 'Confirmation', value: `<code style="background:#f1f5f9;border-radius:4px;padding:2px 6px;font-family:monospace;">${escapeHtml(args.confirmationNumber)}</code>` },
    { label: 'Date / Time', value: `<strong>${escapeHtml(dateTimeStr)}</strong>` },
    { label: 'Portal', value: escapeHtml(`${args.portalId}${args.portalLabel ? ' / ' + args.portalLabel : ''}`) },
    { label: 'Applicant', value: escapeHtml(args.applicantMasked) },
    { label: 'Job', value: `<code style="background:#f1f5f9;border-radius:4px;padding:2px 6px;font-family:monospace;">${escapeHtml(args.jobId)}</code>` },
  ];

  const customerRows = [
    { label: 'Confirmation No.', value: `<code style="background:#f1f5f9;border-radius:4px;padding:2px 6px;font-family:monospace;">${escapeHtml(args.confirmationNumber)}</code>` },
    { label: 'Appointment', value: `<strong>${escapeHtml(dateTimeStr)}</strong>` },
    { label: 'Service', value: escapeHtml(portalTitle) },
  ];

  const rows = args.isCustomerEmail ? customerRows : opsRows;

  const extraDetails = !args.isCustomerEmail && args.details
    ? `${divider}<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Booking Details</p><pre style="margin:0;font-size:12px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${escapeHtml(JSON.stringify(args.details, null, 2))}</pre>`
    : '';

  const customerNotice = args.isCustomerEmail
    ? `${divider}<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;"><tr><td style="padding:12px 16px;font-size:13px;color:#166534;line-height:1.6;">🗂&nbsp; Please keep your confirmation number safe. You may need it when you arrive for your appointment.</td></tr></table>`
    : '';

  const bodyHtml =
    badge('✅ Confirmed', '#dcfce7', '#166534') +
    `<div style="height:20px;"></div>` +
    detailTable(rows) +
    extraDetails +
    customerNotice;

  const html = renderEmailLayout({
    bannerUrl: args.bannerUrl,
    iconEmoji: '📋',
    iconBg: '#dcfce7',
    title: args.isCustomerEmail ? 'Appointment Confirmed' : 'Booking Completed',
    subtitle: args.isCustomerEmail
      ? 'Your visa appointment has been successfully booked. Please find the details below.'
      : 'Booking successfully completed. All details are recorded below.',
    bodyHtml,
    footerNote: args.isCustomerEmail
      ? 'Sent by <strong>Vizeself</strong>. This is an automated confirmation. Please do not reply to this email.'
      : undefined,
  });

  const text = args.isCustomerEmail
    ? [
        `✅ Your Appointment is Confirmed`,
        ``,
        `Confirmation No.: ${args.confirmationNumber}`,
        `Appointment:      ${dateTimeStr}`,
        `Service:          ${portalTitle}`,
        ``,
        `Please keep your confirmation number safe.`,
        ``,
        `— Vizeself`,
      ].join('\n')
    : [
        `BOOKED ✅`,
        `Confirmation: ${args.confirmationNumber}`,
        `Date/Time:    ${dateTimeStr}`,
        `Portal:       ${args.portalId}${args.portalLabel ? ' / ' + args.portalLabel : ''}`,
        `Applicant:    ${args.applicantMasked}`,
        `Job:          ${args.jobId}`,
        ...(args.details ? [``, `Details:`, JSON.stringify(args.details, null, 2)] : []),
      ].join('\n');

  return { subject, html, text };
}
