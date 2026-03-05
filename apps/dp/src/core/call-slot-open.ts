/**
 * Notify CP that a slot was found (slot-check scout job). CP will create and enqueue customer jobs.
 * @param openDates - ISO date strings (YYYY-M-D) of available appointment slots from /TarihGetir.
 *   CP uses these to filter customers by travel-date window before creating jobs.
 * @param scoutJobId - The scout job's own ID so CP can persist open_dates on the job record.
 */
export async function callSlotOpen(
  tenantId: string,
  portalId: string,
  openDates: string[] = [],
  scoutJobId?: string,
  triggeredBy: 'manual' | 'watcher_auto' = 'watcher_auto',
  triggeredByName?: string,
): Promise<{ jobs_created: number; skipped: number } | null> {
  const cpApiUrl = process.env.CP_API_URL;
  const internalSecret = process.env.CP_INTERNAL_SECRET;
  if (!cpApiUrl || !internalSecret) return null;
  const base = cpApiUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/cp/watcher/slot-open`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-internal-secret': internalSecret,
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      portal_id: portalId,
      open_dates: openDates,
      scout_job_id: scoutJobId,
      triggered_by: triggeredBy,
      ...(triggeredByName ? { triggered_by_name: triggeredByName } : {}),
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success?: boolean; data?: { jobs_created: number; skipped: number } };
  return data?.data ?? null;
}
