/**
 * Upload a screenshot to CP so staff/admin can view it in HITL tasks.
 */
export async function uploadScreenshotToCp(
  tenantId: string,
  jobId: string,
  filename: string,
  buffer: Buffer,
  contentType = 'image/png'
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
      content_type: contentType,
      data: buffer.toString('base64'),
    }),
  });
  return res.ok;
}

/**
 * Capture the current page HTML and upload it to CP as a debug artifact.
 * Stored as text/html in job_screenshots; visible in job details → HTML Dumps tab.
 */
export async function uploadHtmlDumpToCp(
  tenantId: string,
  jobId: string,
  filename: string,
  html: string
): Promise<boolean> {
  return uploadScreenshotToCp(
    tenantId,
    jobId,
    filename,
    Buffer.from(html, 'utf8'),
    'text/html'
  );
}
