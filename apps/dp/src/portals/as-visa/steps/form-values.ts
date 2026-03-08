/**
 * Maps customer preferences (Visa Information + portal-specific) to AS-VISA form field values.
 * Keys match AS_VISA_SELECTORS.inputs and AS_VISA_SELECTORS.selects so fill-form can iterate and fill.
 *
 * Customer form stores: idNo, passportNumber, name, surname, middleName, birthDate, email, phone,
 * travelDateMode, travelDateAlgorithm, travelDateSingle, travelDateFrom, travelDateTo,
 * plus portal-specific keys: nationality, appointment, travelSubject, travelDate, appointmentDate, appointmentTime.
 *
 * open_dates (injected by CP slot-open): pre-filtered list of available dates within the customer's
 * appointment window. Used to pick appointmentDate automatically when not already set.
 */

// ---------------------------------------------------------------------------
// Travel date helpers
// ---------------------------------------------------------------------------

function parseDateToUtc(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Date.UTC(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1])));
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY-MM-DD or YYYY-M-D
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const d = new Date(Date.UTC(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3])));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Format a Date as DD/MM/YYYY for AS-VISA datepicker input. */
function formatDdMmYyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Given the customer's travel date and a list of open dates (YYYY-M-D or YYYY-MM-DD),
 * pick the best appointment date according to the algorithm preference.
 *
 * Algorithm:
 *   nearest   → earliest date in [travelDate-45, travelDate-15]
 *   farthest  → latest date in window
 *   middle    → middle date in window
 *   1month    → closest to ~30 days before travel
 *   2months   → closest to ~60 days before travel
 *   default   → nearest
 *
 * Returns DD/MM/YYYY string or empty string if no match.
 */
function pickAppointmentDate(
  travelDate: Date,
  openDates: string[],
  algorithm: string,
): string {
  const windowStart = new Date(travelDate);
  windowStart.setUTCDate(windowStart.getUTCDate() - 45);
  const windowEnd = new Date(travelDate);
  windowEnd.setUTCDate(windowEnd.getUTCDate() - 15);

  const inWindow = openDates
    .map(parseDateToUtc)
    .filter((d): d is Date => d !== null && d >= windowStart && d <= windowEnd)
    .sort((a, b) => a.getTime() - b.getTime());

  if (inWindow.length === 0) return '';

  const algo = String(algorithm || 'nearest').trim();

  if (algo === 'farthest') return formatDdMmYyyy(inWindow[inWindow.length - 1]);
  if (algo === 'middle')   return formatDdMmYyyy(inWindow[Math.floor(inWindow.length / 2)]);

  const targetOffset = algo === '2months' ? 60 : algo === '1month' ? 30 : null;
  if (targetOffset !== null) {
    const target = new Date(travelDate);
    target.setUTCDate(target.getUTCDate() - targetOffset);
    const best = inWindow.reduce((prev, cur) =>
      Math.abs(cur.getTime() - target.getTime()) < Math.abs(prev.getTime() - target.getTime()) ? cur : prev
    );
    return formatDdMmYyyy(best);
  }

  // nearest (default)
  return formatDdMmYyyy(inWindow[0]);
}

/**
 * Resolve the effective travel date string from applicant data.
 * Priority: explicit travelDate > travelDateSingle > travelDateFrom.
 *
 * When travelDateMode is "auto" none of the above will be set.
 * In that case we derive a travel date from the already-resolved appointmentDate:
 * appointmentDate + 30 days puts us squarely inside the portal's acceptance window
 * (travelDate-45 … travelDate-15), so both form validation and display are correct.
 */
function resolveTravelDateStr(applicantData: Record<string, unknown>, resolvedAppointmentDate?: string): string {
  const get = (k: string) => { const v = applicantData[k]; return v != null ? String(v).trim() : ''; };
  const explicit = get('travelDate') || get('travelDateSingle') || get('travelDateFrom');
  if (explicit) return explicit;

  // Auto-mode fallback: derive from the appointment date agent selected
  const apptStr = resolvedAppointmentDate || get('appointmentDate');
  if (!apptStr) return '';
  const apptDate = parseDateToUtc(apptStr);
  if (!apptDate) return '';
  const travelDate = new Date(apptDate);
  travelDate.setUTCDate(travelDate.getUTCDate() + 30);
  return formatDdMmYyyy(travelDate);
}

/**
 * Auto-pick appointment date from open_dates + travel date + algorithm.
 * Returns DD/MM/YYYY or '' if not computable.
 */
function autoPickAppointmentDate(applicantData: Record<string, unknown>): string {
  const get = (k: string) => { const v = applicantData[k]; return v != null ? String(v).trim() : ''; };

  const existing = get('appointmentDate');
  if (existing) return existing;

  const raw = applicantData['open_dates'];
  const openDates: string[] = Array.isArray(raw) ? raw.map(String) : [];
  if (openDates.length === 0) return '';

  // Try explicit travel date first; if auto-mode (none set), derive a synthetic travel date
  // so that ALL open_dates fall inside the portal's acceptance window [travelDate-45, travelDate-15].
  // Strategy: travelDate = latestOpenDate + 16 days
  //   → windowEnd   = travelDate - 15 = latestOpenDate + 1  (latest date is just inside)
  //   → windowStart = travelDate - 45 = latestOpenDate - 29 (covers ~30 days of history)
  // This is algorithm-neutral: nearest picks the earliest, farthest picks the latest,
  // middle picks the median, and 1month/2months use offsets relative to travelDate.
  let travelDateStr = resolveTravelDateStr(applicantData);
  if (!travelDateStr) {
    const sorted = openDates
      .map(parseDateToUtc)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    if (sorted.length === 0) return '';
    const latest = sorted[sorted.length - 1];
    const synthetic = new Date(latest);
    synthetic.setUTCDate(synthetic.getUTCDate() + 16);
    travelDateStr = formatDdMmYyyy(synthetic);
  }

  const travelDate = parseDateToUtc(travelDateStr);
  if (!travelDate) return '';

  const algorithm = get('travelDateAlgorithm') || 'nearest';
  return pickAppointmentDate(travelDate, openDates, algorithm);
}

// ---------------------------------------------------------------------------

export function buildAsVisaFormValues(applicantData: Record<string, unknown>): Record<string, string> {
  const get = (key: string): string => {
    const v = applicantData[key];
    if (v === undefined || v === null) return '';
    return String(v).trim();
  };

  const birthDate = get('birthDate');
  const yearFromBirthDate = birthDate ? birthDate.slice(0, 4) : '';

  // Resolve appointment date first (needed for auto travel-date fallback below)
  const appointmentDate = get('appointmentDate') || autoPickAppointmentDate(applicantData);

  // Resolve travel date: explicit value OR, in auto-mode, derived from the resolved appointment date
  const travelDate = resolveTravelDateStr(applicantData, appointmentDate || undefined);

  return {
    // Visa Information (generic) → selector keys
    name: get('name'),
    surname: get('surname'),
    passportNumber: get('passportNumber'),
    tcKimlikNo: get('idNo') || get('tcKimlikNo'),
    reTckn: get('idNo') || get('tcKimlikNo'),   // must match tcKimlikNo
    dogumYili: yearFromBirthDate || get('dogumYili'),
    phone: get('phone'),
    email: get('email'),
    reEmail: get('email'),                        // must match email

    // Portal-specific (schema keys align with selectors)
    nationality: get('nationality'),
    appointment: get('appointment'),
    travelSubject: get('travelSubject'),
    travelDate,
    appointmentDate,
    appointmentTime: get('appointmentTime'),
  };
}
