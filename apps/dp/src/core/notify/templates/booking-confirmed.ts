import { NOTIFY_EMOJI } from '../severity.js';
import { formatDateTimeTR } from '../format.js';

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
}) {
  const portalTitle = args.portalLabel ? `AS-VISA ${args.portalLabel}` : args.portalId;
  const dateTimeStr = formatDateTimeTR(args.bookedAt);
  const subject = `[BOOKED] ${portalTitle} — ${dateTimeStr} — CONF ${args.confirmationNumber}`;

  const html =
    `<p><b>Booking tamamlandı</b> — full detay (audit / paylaşılabilir)</p>` +
    `<ul>` +
    `<li>Confirmation: <code>${args.confirmationNumber}</code></li>` +
    `<li>Tarih/Saat: <code>${dateTimeStr}</code></li>` +
    `<li>Portal: <code>${args.portalId}${args.portalLabel ? ' / ' + args.portalLabel : ''}</code></li>` +
    `<li>Applicant: <code>${escapeHtml(args.applicantMasked)}</code> (masked)</li>` +
    `<li>Job: <code>${args.jobId}</code></li>` +
    `<li>Tenant: <code>${args.tenantId}</code></li>` +
    `</ul>` +
    `<p>URL: ${args.baseUrl}</p>` +
    (args.details ? `<pre>${escapeHtml(JSON.stringify(args.details, null, 2))}</pre>` : '');

  const text =
    `BOOKED ${NOTIFY_EMOJI.BOOKED}\n` +
    `Confirmation: ${args.confirmationNumber}\n` +
    `Tarih/Saat: ${dateTimeStr}\n` +
    `Portal: ${args.portalId}${args.portalLabel ? ' / ' + args.portalLabel : ''}\n` +
    `Applicant: ${args.applicantMasked} (masked)\n` +
    `job: ${args.jobId}\n` +
    `url: ${args.baseUrl}\n` +
    (args.details ? `details:\n${JSON.stringify(args.details, null, 2)}\n` : '');

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
