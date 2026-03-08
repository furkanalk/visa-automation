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

function code(s: string): string {
  return `<code style="background:#f1f5f9;border-radius:4px;padding:2px 6px;font-family:monospace;font-size:12px;">${escapeHtml(s)}</code>`;
}

function fmtDurationMs(ms: number): string {
  if (ms <= 0) return '--';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function renderBookingConfirmedEmail(args: {
  jobId: string;
  tenantId: string;
  portalId: string;
  portalLabel?: string;
  baseUrl: string;
  confirmationNumber: string;
  bookedAt: Date;
  /** Full un-masked applicant data for ops email */
  applicantData?: Record<string, unknown>;
  /** Masked applicant string (passport + email masked) */
  applicantMasked: string;
  details?: Record<string, unknown>;
  /** Agent name that processed the job */
  agentName?: string | null;
  /** Epoch ms when the job run started */
  jobStartMs?: number;
  /** Epoch ms when the job run ended */
  jobEndMs?: number;
  /** If true, email is addressed to the customer (no job/tenant IDs shown). */
  isCustomerEmail?: boolean;
  /** cid:vizeself-banner or undefined - provided by caller after fetching attachment */
  bannerUrl?: string;
}) {
  const portalTitle = args.portalLabel ?? args.portalId;
  const d = args.details ?? {};
  const ad = args.applicantData ?? {};

  // Parse appointment fields from meta/details (fallback to applicantData for some portals)
  // Use || instead of ?? so that empty strings ('') also fall through to the next fallback.
  // appointmentDate: randevu tarihi (e.g. "08.03.2026") — NOT job bookedAt timestamp
  const str = (v: unknown) => (v != null ? String(v).trim() : '');
  const appointmentDate = (str(d.appointmentDate) || str(d.AppointmentDate) || str(ad.appointmentDate) || str(ad.AppointmentDate)) as string;
  const appointmentTime = (str(d.appointmentTime) || str(d.AppointmentTime) || str(ad.appointmentTime) || str(ad.AppointmentTime)) as string;
  const travelDate = (str(d.travelDate) || str(d.TravelDate) || str(d.travelDateSingle) || str(d.travelDateFrom)
    || str(ad.travelDate) || str(ad.TravelDate) || str(ad.travelDateSingle) || str(ad.travelDateFrom)) as string;
  const travelSubject = (str(d.travelSubject) || str(d.TravelSubject) || str(ad.travelSubject)) as string;
  // nationality may live in details or applicantData depending on portal
  const nationality = (str(d.nationality) || str(d.Nationality) || str(ad.nationality) || str(ad.Nationality)) as string;
  // appointment = randevu tipi / ülkesi (#AppointmentTabID select value in as-visa)
  const appointmentType = (str(d.appointment) || str(d.Appointment) || str(d.appointmentType) || str(ad.appointment)) as string;

  // Full name: combine name + surname (applicant_data stores them separately)
  const fullName = [ad.name, ad.surname].filter(Boolean).join(' ') || String(ad.fullName ?? '') || '';
  // Passport number: applicant_data uses 'passportNumber', some portals use 'passport'
  const passportNo = String(ad.passportNumber ?? ad.passport ?? '');
  const birthDate = String(ad.birthDate ?? ad.BirthDate ?? '');

  // Randevu tarihi/saati — sadece portaldan gelen gerçek randevu bilgisi
  const appointmentDisplay = appointmentDate
    ? `${appointmentDate}${appointmentTime ? ' ' + appointmentTime : ''}`
    : 'N/A';

  // bookedAt: işlemin tamamlandığı zaman (ops email için)
  const bookedAtDisplay = formatDateTimeTR(args.bookedAt);

  const subject = args.isCustomerEmail
    ? `✅ Appointment Confirmed – ${portalTitle}`
    : `✅ [BOOKED] ${portalTitle} – ${appointmentDisplay} – #${args.confirmationNumber}`;

  // Duration
  const durationMs = args.jobStartMs && args.jobEndMs ? args.jobEndMs - args.jobStartMs : 0;

  // OPS email rows
  const opsMainRows: { label: string; value: string }[] = [
    { label: '\u2705 Confirmation', value: `<strong style="font-size:15px;">${code(args.confirmationNumber)}</strong>` },
    { label: '\uD83D\uDCC5 Appointment Date', value: `<strong>${escapeHtml(appointmentDisplay)}</strong>` },
    ...(travelDate ? [{ label: '\u2708\uFE0F Travel Date', value: escapeHtml(travelDate) }] : []),
    ...(travelSubject ? [{ label: '\uD83D\uDDC2 Travel Subject', value: escapeHtml(travelSubject) }] : []),
    ...(appointmentType ? [{ label: '\uD83C\uDFE2 Appointment Type', value: escapeHtml(appointmentType) }] : []),
    ...(nationality ? [{ label: '\uD83C\uDF0D Nationality', value: escapeHtml(nationality) }] : []),
    { label: '\uD83D\uDD52 Booked At', value: escapeHtml(bookedAtDisplay) },
    { label: '\uD83C\uDF10 Portal', value: escapeHtml(`${args.portalId}${args.portalLabel ? ' / ' + args.portalLabel : ''}`) },
  ];

  // Applicant details block - use raw data for ops
  const applicantRows: { label: string; value: string }[] = [];
  if (fullName) applicantRows.push({ label: 'Full Name', value: escapeHtml(fullName) });
  if (ad.email) applicantRows.push({ label: 'Email', value: escapeHtml(String(ad.email)) });
  if (ad.phone) applicantRows.push({ label: 'Phone', value: escapeHtml(String(ad.phone)) });
  if (passportNo) applicantRows.push({ label: 'Passport No.', value: escapeHtml(passportNo) });
  if (ad.TcKimlikNo ?? ad.tcKimlik ?? ad.tc_kimlik_no) applicantRows.push({ label: 'TC ID', value: escapeHtml(String(ad.TcKimlikNo ?? ad.tcKimlik ?? ad.tc_kimlik_no)) });
  if (birthDate) applicantRows.push({ label: 'Birth Date', value: escapeHtml(birthDate) });
  if (ad.idNo) applicantRows.push({ label: 'ID No.', value: escapeHtml(String(ad.idNo)) });
  if (applicantRows.length === 0) applicantRows.push({ label: 'Applicant', value: escapeHtml(args.applicantMasked) });

  const systemRows: { label: string; value: string }[] = [
    { label: 'Job ID', value: code(args.jobId) },
    { label: 'Tenant', value: code(args.tenantId) },
    ...(args.agentName ? [{ label: 'Agent', value: escapeHtml(args.agentName) }] : []),
    ...(args.jobStartMs ? [{ label: 'Started', value: escapeHtml(formatDateTimeTR(new Date(args.jobStartMs))) }] : []),
    ...(args.jobEndMs ? [{ label: 'Finished', value: escapeHtml(formatDateTimeTR(new Date(args.jobEndMs))) }] : []),
    ...(durationMs > 0 ? [{ label: 'Duration', value: escapeHtml(fmtDurationMs(durationMs)) }] : []),
  ];

  const sectionTitle = (t: string) =>
    `<p style="margin:20px 0 6px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">${t}</p>`;

  const opsBodyHtml =
    badge('\u2705 BOOKED', '#dcfce7', '#166534') +
    `<div style="height:16px;"></div>` +
    sectionTitle('Appointment') +
    detailTable(opsMainRows) +
    sectionTitle('Applicant') +
    detailTable(applicantRows) +
    sectionTitle('System') +
    detailTable(systemRows);

  // CUSTOMER email — tüm rezervasyon detayları, iç sistem bilgisi yok
  const customerRows: { label: string; value: string }[] = [
    { label: '\uD83D\uDD16 Confirmation No.', value: `<strong style="font-size:15px;">${code(args.confirmationNumber)}</strong>` },
    { label: '\uD83D\uDCC5 Appointment Date', value: `<strong>${escapeHtml(appointmentDisplay)}</strong>` },
    ...(travelDate ? [{ label: '\u2708\uFE0F Travel Date', value: escapeHtml(travelDate) }] : []),
    ...(travelSubject ? [{ label: '\uD83D\uDDC2 Travel Subject', value: escapeHtml(travelSubject) }] : []),
    ...(appointmentType ? [{ label: '\uD83C\uDFE2 Appointment Type', value: escapeHtml(appointmentType) }] : []),
    ...(nationality ? [{ label: '\uD83C\uDF0D Nationality', value: escapeHtml(nationality) }] : []),
    { label: '\uD83C\uDF10 Service', value: escapeHtml(portalTitle) },
    ...(fullName ? [{ label: '\uD83D\uDC64 Name', value: escapeHtml(fullName) }] : []),
    ...(passportNo ? [{ label: '\uD83D\uDCD8 Passport No.', value: escapeHtml(passportNo) }] : []),
    ...(birthDate ? [{ label: '\uD83C\uDF82 Date of Birth', value: escapeHtml(birthDate) }] : []),
    ...(ad.phone ? [{ label: '\uD83D\uDCF1 Phone', value: escapeHtml(String(ad.phone)) }] : []),
  ];

  const customerBodyHtml =
    badge('\u2705 Appointment Confirmed', '#dcfce7', '#166634') +
    `<div style="height:16px;"></div>` +
    detailTable(customerRows) +
    `<div style="margin:16px 0 4px;font-size:12px;color:#64748b;text-align:center;">📎 Your booking receipt is attached to this email as a PDF.</div>` +
    divider +
    `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
      <tr><td style="padding:14px 16px;font-size:13px;color:#166534;line-height:1.7;">
        Please save your confirmation number. You may be asked to present it on the day of your appointment.
      </td></tr>
    </table>`;

  // Assemble
  const html = renderEmailLayout({
    bannerUrl: args.bannerUrl,
    iconEmoji: '\uD83D\uDCCB',
    iconBg: '#dcfce7',
    title: args.isCustomerEmail ? 'Your Appointment is Confirmed' : 'Booking Completed',
    subtitle: args.isCustomerEmail
      ? 'Your visa appointment has been successfully scheduled. All details are listed below.'
      : 'Booking successfully completed. All details are recorded below.',
    bodyHtml: args.isCustomerEmail ? customerBodyHtml : opsBodyHtml,
    footerNote: args.isCustomerEmail
      ? 'This email was sent automatically by <strong>Vizeself</strong>. Please do not reply to this email.'
      : undefined,
  });

  const text = args.isCustomerEmail
    ? [
        'Your Appointment is Confirmed',
        '',
        `Confirmation No. : ${args.confirmationNumber}`,
        `Appointment Date : ${appointmentDisplay}`,
        ...(travelDate ? [`Travel Date      : ${travelDate}`] : []),
        ...(travelSubject ? [`Travel Subject   : ${travelSubject}`] : []),
        ...(appointmentType ? [`Appointment Type : ${appointmentType}`] : []),
        ...(nationality ? [`Nationality      : ${nationality}`] : []),
        `Service          : ${portalTitle}`,
        ...(fullName ? [`Name             : ${fullName}`] : []),
        ...(passportNo ? [`Passport No.     : ${passportNo}`] : []),
        ...(birthDate ? [`Date of Birth    : ${birthDate}`] : []),
        ...(ad.phone ? [`Phone            : ${String(ad.phone)}`] : []),
        '',
        'Please save your confirmation number.',
        '',
        '-- Vizeself',
      ].join('\n')
    : [
        'BOOKED',
        `Confirmation     : ${args.confirmationNumber}`,
        `Appointment Date : ${appointmentDisplay}`,
        ...(travelDate ? [`Travel Date      : ${travelDate}`] : []),
        ...(travelSubject ? [`Travel Subject   : ${travelSubject}`] : []),
        ...(appointmentType ? [`Appointment Type : ${appointmentType}`] : []),
        ...(nationality ? [`Nationality      : ${nationality}`] : []),
        `Booked At        : ${bookedAtDisplay}`,
        `Portal           : ${args.portalId}${args.portalLabel ? ' / ' + args.portalLabel : ''}`,
        ...(fullName ? [`Full Name        : ${fullName}`] : []),
        ...(passportNo ? [`Passport No.     : ${passportNo}`] : []),
        ...(birthDate ? [`Date of Birth    : ${birthDate}`] : []),
        ...(ad.phone ? [`Phone            : ${String(ad.phone)}`] : []),
        ...(ad.email ? [`Email            : ${String(ad.email)}`] : []),
        `Applicant (masked): ${args.applicantMasked}`,
        `Job ID           : ${args.jobId}`,
        ...(args.agentName ? [`Agent            : ${args.agentName}`] : []),
        ...(args.jobStartMs ? [`Started          : ${formatDateTimeTR(new Date(args.jobStartMs))}`] : []),
        ...(args.jobEndMs ? [`Finished         : ${formatDateTimeTR(new Date(args.jobEndMs))}`] : []),
        ...(durationMs > 0 ? [`Duration         : ${fmtDurationMs(durationMs)}`] : []),
      ].join('\n');

  return { subject, html, text };
}
