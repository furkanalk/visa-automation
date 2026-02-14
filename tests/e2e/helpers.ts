import { BASE_URL, MOCK_PORTAL_URL, TENANT_ID, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './config.js';

export async function createJob(overrides?: { visa_type?: string; applicant_data?: Record<string, unknown> }): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_ID },
    body: JSON.stringify({
      visa_type: 'as-visa',
      applicant_data: { email: 'e2e@example.com', passport: 'E2E123' },
      ...overrides,
    }),
  });
  if (!res.ok) throw new Error('Create job failed: ' + res.status + ' ' + (await res.text()));
  const data = (await res.json()) as { success?: boolean; data?: { id: string }; id?: string };
  const id = data.data?.id ?? data.id;
  if (!id) throw new Error('No job id in response');
  return id;
}

export async function getJobStatus(jobId: string): Promise<{ status: string }> {
  const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`, { headers: { 'x-tenant-id': TENANT_ID } });
  if (!res.ok) throw new Error('Get job failed: ' + res.status);
  const data = (await res.json()) as { data?: { status: string }; status?: string };
  return { status: data.data?.status ?? data.status ?? 'UNKNOWN' };
}

export async function pollUntilStatus(
  jobId: string,
  expected: string | string[],
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<{ status: string }> {
  const timeoutMs = opts?.timeoutMs ?? POLL_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? POLL_INTERVAL_MS;
  const want = Array.isArray(expected) ? expected : [expected];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = await getJobStatus(jobId);
    if (want.includes(status)) return { status };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const { status } = await getJobStatus(jobId);
  throw new Error('Timeout waiting for ' + want.join('|') + ', last status: ' + status);
}

export async function setMockPortalConfig(portalId: string, config: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${MOCK_PORTAL_URL}/api/config/${portalId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Set mock config failed: ' + res.status);
}

export async function resetMockPortal(): Promise<void> {
  const res = await fetch(`${MOCK_PORTAL_URL}/api/reset`, { method: 'POST' });
  if (!res.ok) throw new Error('Reset mock failed: ' + res.status);
}
