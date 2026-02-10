export function renderBookingConfirmedEmail(args: {
  jobId: string;
  tenantId: string;
  portalId: string;
  baseUrl: string;
  confirmationNumber: string;
  details?: Record<string, unknown>;
}) {
  const nowIso = new Date().toISOString();

  const subject = `[VISA] BOOKED ✅ — job ${args.jobId}`;

  const html =
    `<p><b>✅ Appointment booked</b></p>` +
    `<ul>` +
    `<li>job: <code>${args.jobId}</code></li>` +
    `<li>portal: <code>${args.portalId}</code></li>` +
    `<li>tenant: <code>${args.tenantId}</code></li>` +
    `<li>time: <code>${nowIso}</code></li>` +
    `<li>confirmation: <code>${args.confirmationNumber}</code></li>` +
    `</ul>` +
    `<p>URL: ${args.baseUrl}</p>` +
    (args.details ? `<pre>${escapeHtml(JSON.stringify(args.details, null, 2))}</pre>` : '');

  const text =
    `BOOKED ✅\n` +
    `job: ${args.jobId}\n` +
    `portal: ${args.portalId}\n` +
    `tenant: ${args.tenantId}\n` +
    `time: ${nowIso}\n` +
    `confirmation: ${args.confirmationNumber}\n` +
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
