/**
 * Notify formatting: Turkey time, masked applicant (audit-safe).
 */

/** Format date as HH:mm:ss in Turkey (Europe/Istanbul). */
export function formatTimeTR(date: Date = new Date()): string {
  try {
    return date.toLocaleTimeString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return date.toISOString().slice(11, 19);
  }
}

/** Format date-time for "Tarih/Saat" (TR): 2026-02-12 09:45 */
export function formatDateTimeTR(date: Date = new Date()): string {
  try {
    const d = date.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const t = date.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
    return `${d} ${t}`;
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Mask passport: P*****34 (first char + last 2 + stars). */
export function maskPassport(passport: string | undefined): string {
  if (!passport || passport.length < 4) return '****';
  return passport[0] + '*****' + passport.slice(-2);
}

/** Mask email: e***@example.com (first char + *** + @domain). */
export function maskEmail(email: string | undefined): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (!local?.length) return '***@' + domain;
  return local[0] + '***@' + domain;
}

/** Applicant summary masked for audit/notify. */
export function maskApplicant(applicant?: Record<string, unknown>): string {
  if (!applicant) return '—';
  const parts: string[] = [];
  if (applicant.passport != null) parts.push(maskPassport(String(applicant.passport)));
  if (applicant.email != null) parts.push(maskEmail(String(applicant.email)));
  return parts.length ? parts.join(' / ') : '—';
}
