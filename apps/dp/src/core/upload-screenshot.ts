/**
 * Upload a screenshot to CP so staff/admin can view it in HITL tasks.
 */
export async function uploadScreenshotToCp(
  tenantId: string,
  jobId: string,
  filename: string,
  buffer: Buffer
): Promise<boolean> {
  const cpApiUrl = process.env.CP_API_URL;
  const internalSecret = process.env.CP_INTERNAL_SECRET;
  if (!cpApiUrl || !internalSecret) return false;
  const base = cpApiUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/cp/screenshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'x-internal-secret': internalSecret,
    },
    body: JSON.stringify({
      job_id: jobId,
      filename,
      data: buffer.toString('base64'),
    }),
  });
  return res.ok;
}
