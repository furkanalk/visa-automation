/**
 * GET /cp/jobs/:jobId/receipt.pdf
 *
 * Generates and streams a booking receipt PDF for a completed job.
 *
 * Query params:
 *   type   = "customer" | "ops"   (default: "customer")
 *   token  = signed HMAC token    (for unauthenticated customer access via email link)
 *
 * Auth:
 *  - When called from admin portal (authenticated CP session) → tenantMiddleware already applied
 *  - When called via email link with ?token=  → validated against RECEIPT_HMAC_SECRET
 */

import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '@visa-automation/db';
// pdfkit is CJS; use createRequire for ESM compatibility
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BANNER_PATH = join(__dirname, '..', '..', 'banner-email.png');
// __dirname at runtime = dist/routes/  →  ../../fonts = apps/cp/fonts/
const FONT_REGULAR = join(__dirname, '..', '..', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD    = join(__dirname, '..', '..', 'fonts', 'DejaVuSans-Bold.ttf');
const HMAC_SECRET = process.env.RECEIPT_HMAC_SECRET ?? process.env.CP_JWT_SECRET ?? 'changeme';

// ─── token helpers ──────────────────────────────────────────────────────────

export function buildReceiptToken(jobId: string, type: 'customer' | 'ops'): string {
  const payload = `${jobId}:${type}`;
  const sig = createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyReceiptToken(token: string, jobId: string, type: string): boolean {
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return false;
    const payload = Buffer.from(b64, 'base64url').toString();
    if (payload !== `${jobId}:${type}`) return false;
    const expected = createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ─── PDF builder ─────────────────────────────────────────────────────────────

interface ReceiptData {
  jobId: string;
  tenantId: string;
  portalId: string;
  confirmationNumber: string;
  bookedAt: Date;
  appointmentDate: string;
  appointmentTime: string;
  travelDate: string;
  travelSubject: string;
  nationality: string;
  appointmentType: string;
  fullName: string;
  passportNo: string;
  birthDate: string;
  email: string;
  phone: string;
  agentName?: string;
  jobStartMs?: number;
  jobEndMs?: number;
}

const COLORS = {
  primary:      '#1e40af',  // deep blue
  primaryLight: '#eff6ff',  // very light blue bg
  primaryBorder:'#bfdbfe',  // blue border
  accent:       '#16a34a',  // green for confirmed badge
  accentLight:  '#f0fdf4',
  accentBorder: '#bbf7d0',
  dark:         '#0f172a',  // near-black for headings
  slate:        '#334155',
  slateLight:   '#64748b',
  slateLighter: '#94a3b8',
  line:         '#e2e8f0',  // divider lines
  rowAlt:       '#f8fafc',
  white:        '#ffffff',
};

function buildPdf(data: ReceiptData, type: 'customer' | 'ops'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Load fonts — fall back to Helvetica if TTF not found (dev/test environments)
    let fontRegular: string | null = null;
    let fontBold: string | null = null;
    try { readFileSync(FONT_REGULAR); fontRegular = FONT_REGULAR; } catch { /* use built-in */ }
    try { readFileSync(FONT_BOLD);    fontBold    = FONT_BOLD;    } catch { /* use built-in */ }

    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;   // 595.28
    const H = doc.page.height;  // 841.89
    const PAD = 40;
    const CONTENT_W = W - PAD * 2;

    // ── helpers ──────────────────────────────────────────────────────────────
    function rect(x: number, y: number, w: number, h: number, fill: string, stroke?: string, radius = 0) {
      doc.save();
      if (radius) doc.roundedRect(x, y, w, h, radius); else doc.rect(x, y, w, h);
      doc.fillColor(fill);
      if (stroke) { doc.strokeColor(stroke).fillAndStroke(); } else { doc.fill(); }
      doc.restore();
    }

    function hline(y: number, x1 = PAD, x2 = W - PAD) {
      doc.save().moveTo(x1, y).lineTo(x2, y).strokeColor(COLORS.line).lineWidth(0.5).stroke().restore();
    }

    // ── 1. Background & top bar ───────────────────────────────────────────
    // Full-page light background
    rect(0, 0, W, H, '#f8fafc');
    // Deep-blue top bar
    rect(0, 0, W, 6, COLORS.primary);

    let y = 18;

    // ── 2. Banner ─────────────────────────────────────────────────────────
    try {
      const banner = readFileSync(BANNER_PATH);
      const bannerH = Math.round(CONTENT_W * (120 / 600));
      doc.image(banner, PAD, y, { width: CONTENT_W, height: bannerH });
      y += bannerH + 14;
    } catch {
      y += 10;
    }

    // ── 3. White card ─────────────────────────────────────────────────────
    const CARD_X = PAD - 4;
    const CARD_W = CONTENT_W + 8;
    const CARD_TOP = y;

    // We'll draw the card after we know its height; just track y.

    // ── 4. Confirmed badge ────────────────────────────────────────────────
    y += 16;
    const BADGE_W = 180;
    const BADGE_X = (W - BADGE_W) / 2;
    rect(BADGE_X, y, BADGE_W, 24, COLORS.accentLight, COLORS.accentBorder, 12);
    doc.font(fontBold ?? 'Helvetica-Bold').fontSize(9).fillColor(COLORS.accent)
       .text('✓  APPOINTMENT CONFIRMED', BADGE_X, y + 7, { width: BADGE_W, align: 'center' });
    y += 36;

    // ── 5. Confirmation number block ──────────────────────────────────────
    const CONF_W = 260;
    const CONF_X = (W - CONF_W) / 2;
    rect(CONF_X, y, CONF_W, 52, COLORS.primaryLight, COLORS.primaryBorder, 8);
    doc.font(fontRegular ?? 'Helvetica').fontSize(8).fillColor(COLORS.slateLight)
       .text('CONFIRMATION NUMBER', CONF_X, y + 9, { width: CONF_W, align: 'center', characterSpacing: 0.6 });
    doc.font(fontBold ?? 'Helvetica-Bold').fontSize(18).fillColor(COLORS.primary)
       .text(data.confirmationNumber || '—', CONF_X, y + 22, { width: CONF_W, align: 'center' });
    y += 64;

    hline(y); y += 14;

    // ── 6. Section renderer ───────────────────────────────────────────────
    function section(title: string, rows: [string, string | undefined][], twoCol = false): void {
      const visibleRows = rows.filter(([, v]) => v && v.trim());
      if (visibleRows.length === 0) return;

      // Section title
      doc.font(fontBold ?? 'Helvetica-Bold').fontSize(7).fillColor(COLORS.primary)
         .text(title.toUpperCase(), PAD, y, { characterSpacing: 0.9 });
      y += 14;

      if (twoCol) {
        // Two-column layout for dense sections
        const COL_W = (CONTENT_W - 12) / 2;
        let col = 0;
        let colY = y;
        let rightY = y;
        for (const [label, value] of visibleRows) {
          const cx = col === 0 ? PAD : PAD + COL_W + 12;
          const cy = col === 0 ? colY : rightY;
          // Row bg
          rect(cx, cy, COL_W, 19, col % 2 === 0 ? COLORS.white : COLORS.rowAlt);
          doc.font(fontRegular ?? 'Helvetica').fontSize(8).fillColor(COLORS.slateLight)
             .text(label, cx + 5, cy + 5, { width: 80, lineBreak: false });
          doc.font(fontRegular ?? 'Helvetica').fontSize(8).fillColor(COLORS.dark)
             .text(value!, cx + 88, cy + 5, { width: COL_W - 93, lineBreak: false });
          if (col === 0) { colY += 19; } else { rightY += 19; }
          col = 1 - col;
        }
        y = Math.max(colY, rightY) + 6;
      } else {
        // Single-column
        const LABEL_W = 150;
        const VALUE_W = CONTENT_W - LABEL_W - 8;
        let alt = false;
        for (const [label, value] of visibleRows) {
          if (alt) rect(PAD, y, CONTENT_W, 19, COLORS.rowAlt);
          alt = !alt;
          doc.font(fontRegular ?? 'Helvetica').fontSize(8.5).fillColor(COLORS.slateLight)
             .text(label, PAD + 5, y + 5, { width: LABEL_W, lineBreak: false });
          doc.font(fontRegular ?? 'Helvetica').fontSize(8.5).fillColor(COLORS.dark)
             .text(value!, PAD + LABEL_W + 8, y + 5, { width: VALUE_W, lineBreak: false });
          y += 19;
        }
        y += 6;
      }

      hline(y); y += 12;
    }

    // ── 7. Appointment section ────────────────────────────────────────────
    const apptDisplay = data.appointmentDate
      ? `${data.appointmentDate}${data.appointmentTime ? '  •  ' + data.appointmentTime : ''}`
      : '—';
    const bookedAtStr = (() => {
      try {
        return new Date(data.bookedAt).toLocaleString('tr-TR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
        });
      } catch { return String(data.bookedAt); }
    })();

    section('Appointment Details', [
      ['Appointment Date & Time', apptDisplay],
      ['Travel Date',            data.travelDate  || undefined],
      ['Travel Subject',         data.travelSubject || undefined],
      ['Appointment Type',       data.appointmentType || undefined],
      ['Nationality',            data.nationality || undefined],
      ['Service / Portal',       data.portalId || undefined],
      ['Booked At',              bookedAtStr],
    ]);

    // ── 8. Applicant section ──────────────────────────────────────────────
    section('Applicant Information', [
      ['Full Name',     data.fullName    || undefined],
      ['Passport No.',  data.passportNo  || undefined],
      ['Date of Birth', data.birthDate   || undefined],
      ['Email',         data.email       || undefined],
      ['Phone',         data.phone       || undefined],
    ], true);

    // ── 9. Internal section (ops only) ────────────────────────────────────
    if (type === 'ops') {
      const durationMs = data.jobStartMs && data.jobEndMs ? data.jobEndMs - data.jobStartMs : 0;
      const fmtDur = (ms: number) => {
        const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
      };
      const fmtTs = (ms: number) => {
        try { return new Date(ms).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Istanbul' }); }
        catch { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
      };
      section('Internal Details', [
        ['Job ID',    data.jobId],
        ['Tenant ID', data.tenantId],
        ['Agent',     data.agentName || undefined],
        ['Started',   data.jobStartMs ? fmtTs(data.jobStartMs) : undefined],
        ['Finished',  data.jobEndMs  ? fmtTs(data.jobEndMs)   : undefined],
        ['Duration',  durationMs > 0 ? fmtDur(durationMs)     : undefined],
      ]);
    }

    // ── 10. White card background (drawn now that we know height) ─────────
    const CARD_H = y + 10 - CARD_TOP;
    // Draw card behind content — use doc.save/restore to paint behind by re-ordering not possible in pdfkit.
    // Instead just draw a subtle border around the content area.
    doc.save()
       .roundedRect(CARD_X, CARD_TOP, CARD_W, CARD_H, 6)
       .strokeColor(COLORS.line).lineWidth(0.8).stroke()
       .restore();

    // ── 11. Footer ────────────────────────────────────────────────────────
    const footerY = H - 36;
    rect(0, footerY - 8, W, 44, '#f1f5f9');
    hline(footerY - 8);
    const genDate = (() => {
      try { return new Date().toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Istanbul' }); }
      catch { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
    })();
    doc.font(fontRegular ?? 'Helvetica').fontSize(7.5).fillColor(COLORS.slateLighter)
       .text(
         `This document was generated automatically by Vizeself  •  ${genDate}`,
         PAD, footerY + 2, { width: CONTENT_W, align: 'center' },
       );

    // Bottom accent bar
    rect(0, H - 6, W, 6, COLORS.primary);

    doc.end();
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

interface ReceiptParams {
  jobId: string;
}
interface ReceiptQuery {
  type?: string;
  token?: string;
}

export const receiptRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  app.get<{ Params: ReceiptParams; Querystring: ReceiptQuery }>(
    '/:jobId/receipt.pdf',
    async (request, reply) => {
      const { jobId } = request.params;
      const type = (request.query.type === 'ops' ? 'ops' : 'customer') as 'customer' | 'ops';
      const token = request.query.token;

      // Auth: either a valid HMAC token OR the request already passed tenantMiddleware
      const tenantId: string | undefined = (request as any).tenantId;
      const tokenValid = token ? verifyReceiptToken(token, jobId, type) : false;
      if (!tenantId && !tokenValid) {
        return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
      }

      // Fetch job
      let jobQuery = db
        .selectFrom('jobs')
        .select(['id', 'tenant_id', 'applicant_data', 'visa_type'])
        .where('id', '=', jobId);
      if (tenantId) jobQuery = jobQuery.where('tenant_id', '=', tenantId);
      const job = await jobQuery.executeTakeFirst();

      if (!job) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
      }

      // Fetch job_status_summary for confirmation_number and timestamps
      const summary = await db
        .selectFrom('job_status_summary')
        .select(['confirmation_number', 'completed_at'])
        .where('job_id', '=', jobId)
        .executeTakeFirst();

      // Fetch booking_meta from the COMPLETED STATE_TRANSITION event
      const completedEvent = await db
        .selectFrom('job_events')
        .select(['payload', 'created_at'])
        .where('job_id', '=', jobId)
        .where('event_type', '=', 'STATE_TRANSITION')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();

      const eventPayload = (completedEvent?.payload ?? {}) as Record<string, unknown>;
      const bookingMeta = (eventPayload.booking_meta ?? {}) as Record<string, unknown>;

      const ad = (job.applicant_data ?? {}) as Record<string, unknown>;
      const pick = (...keys: string[]): string => {
        for (const k of keys) {
          const v = bookingMeta[k] ?? ad[k];
          if (v != null && String(v).trim()) return String(v).trim();
        }
        return '';
      };

      const data: ReceiptData = {
        jobId: job.id,
        tenantId: job.tenant_id,
        portalId: job.visa_type,
        confirmationNumber: summary?.confirmation_number ?? pick('confirmation_number') ?? 'N/A',
        bookedAt: summary?.completed_at ?? completedEvent?.created_at ?? new Date(),
        appointmentDate: pick('appointmentDate'),
        appointmentTime: pick('appointmentTime'),
        travelDate: pick('travelDate', 'travelDateSingle', 'travelDateFrom'),
        travelSubject: pick('travelSubject'),
        nationality: pick('nationality'),
        appointmentType: pick('appointment', 'appointmentType'),
        fullName: [ad.name, ad.surname].filter(Boolean).join(' ') || String(ad.fullName ?? '') || '',
        passportNo: String(ad.passportNumber ?? ad.passport ?? ''),
        birthDate: String(ad.birthDate ?? ad.BirthDate ?? ''),
        email: String(ad.email ?? ''),
        phone: String(ad.phone ?? ''),
      };

      // For ops: fetch agent name and run timing from job_runs
      if (type === 'ops') {
        const jobRun = await db
          .selectFrom('job_runs')
          .leftJoin('agents', 'agents.id', 'job_runs.agent_id')
          .select(['job_runs.started_at', 'job_runs.finished_at', 'agents.name as agent_name'])
          .where('job_runs.job_id', '=', jobId)
          .orderBy('job_runs.started_at', 'desc')
          .executeTakeFirst();

        if (jobRun) {
          data.agentName = (jobRun as any).agent_name ?? undefined;
          data.jobStartMs = jobRun.started_at ? new Date(jobRun.started_at).getTime() : undefined;
          data.jobEndMs = jobRun.finished_at ? new Date(jobRun.finished_at).getTime() : undefined;
        }
      }

      const pdf = await buildPdf(data, type);

      const filename = `receipt-${jobId.slice(0, 8)}.pdf`;
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .header('Content-Length', pdf.length)
        .header('Cache-Control', 'private, no-store');
      return reply.send(pdf);
    },
  );
};
