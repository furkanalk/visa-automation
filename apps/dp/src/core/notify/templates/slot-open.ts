import type { JobQueuePayload } from '@visa-automation/shared';
import { NOTIFY_EMOJI } from '../severity.js';

export function renderSlotOpenEmail(args: {
  jobId: string;
  tenantId: string;
  portalId: string;
  baseUrl: string;
  dates: string[];
  payload?: JobQueuePayload;
}) {
  const nowIso = new Date().toISOString();
  const datesText = args.dates.slice(0, 20).join(', ');

  const subject = `[VISA] SLOT OPEN ${NOTIFY_EMOJI.SLOT_OPEN} — job ${args.jobId}`;

  const html =
    `<p><b>${NOTIFY_EMOJI.SLOT_OPEN} Slot open</b></p>` +
    `<ul>` +
    `<li>job: <code>${args.jobId}</code></li>` +
    `<li>portal: <code>${args.portalId}</code></li>` +
    `<li>tenant: <code>${args.tenantId}</code></li>` +
    `<li>time: <code>${nowIso}</code></li>` +
    `<li>dates: <code>${datesText}</code></li>` +
    `</ul>` +
    `<p>URL: ${args.baseUrl}</p>`;

  const text =
    `SLOT OPEN\n` +
    `job: ${args.jobId}\n` +
    `portal: ${args.portalId}\n` +
    `tenant: ${args.tenantId}\n` +
    `time: ${nowIso}\n` +
    `dates: ${datesText}\n` +
    `url: ${args.baseUrl}\n`;

  return { subject, html, text };
}
