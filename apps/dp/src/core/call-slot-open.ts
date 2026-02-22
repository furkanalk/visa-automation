/**
 * Notify CP that a slot was found (slot-check scout job). CP will create and enqueue customer jobs.
 */
export async function callSlotOpen(tenantId: string, portalId: string): Promise<{ jobs_created: number } | null> {
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
    body: JSON.stringify({ tenant_id: tenantId, portal_id: portalId }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success?: boolean; data?: { jobs_created: number } };
  return data?.data ?? null;
}
