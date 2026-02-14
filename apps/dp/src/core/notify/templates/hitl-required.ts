import { TELEGRAM_EMOJI } from '../severity.js';

/** Email subject: [HITL] Turnstile required — job <id> (expires 180s) */
export function renderHitlRequiredEmail(args: {
  jobId: string;
  hitlType: string;
  expiresSeconds: number;
  panelUrl: string;
}) {
  const subject = `[HITL] ${args.hitlType} required — job ${args.jobId} (expires ${args.expiresSeconds}s)`;
  const html =
    `<p><b>HITL REQUIRED</b> ${TELEGRAM_EMOJI.HITL_REQUIRED}</p>` +
    `<ul>` +
    `<li>Type: <code>${args.hitlType}</code></li>` +
    `<li>Job: <code>${args.jobId}</code></li>` +
    `<li>Expires: ${args.expiresSeconds}s</li>` +
    `<li>Link: <a href="${args.panelUrl}">${args.panelUrl}</a></li>` +
    `</ul>`;
  const text =
    `HITL REQUIRED ${TELEGRAM_EMOJI.HITL_REQUIRED}\n` +
    `Type: ${args.hitlType}\n` +
    `Job: ${args.jobId}\n` +
    `Expires: ${args.expiresSeconds}s\n` +
    `Link: ${args.panelUrl}\n`;
  return { subject, html, text };
}
