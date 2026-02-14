/**
 * E2E: CAPTCHA → HITL → resolve → continue.
 * Mock portal triggers HITL; resolve via CP API; assert job continues.
 * Run: npm run e2e:hitl. Prerequisites: CP, DP, mock-portal, Redis, Postgres.
 */
import { createJob, pollUntilStatus, setMockPortalConfig, resetMockPortal } from '../helpers.js';
import { BASE_URL, TENANT_ID } from '../config.js';

async function main() {
  await resetMockPortal();
  await setMockPortalConfig('as-visa', {
    enabled: true,
    behavior: { pageLoadDelayMs: 100, formSubmitDelayMs: 200, slotSearchDelayMs: 200, randomDelayMs: 0, errorRate: 0, maintenanceMode: false },
    captcha: { enabled: true, autoSolveDelayMs: 0, failRate: 0 }, // Requires HITL (no auto-solve)
    slots: { availableDates: ['2026-03-15'], availableTimes: ['09:00'], randomizeAvailability: false, slotDisappearChance: 0 },
  });

  const jobId = await createJob();
  console.log('Created job', jobId);

  const { status: afterWait } = await pollUntilStatus(jobId, ['WAITING_HITL', 'SLOT_FOUND', 'COMPLETED', 'FAILED_TERMINAL', 'FAILED_RETRYABLE'], { timeoutMs: 60000 });
  if (afterWait === 'WAITING_HITL') {
    // Resolve HITL via CP (get task id from CP HITL list, then resolve)
    const listRes = await fetch(`${BASE_URL}/cp/hitl?limit=5`, { headers: { 'x-tenant-id': TENANT_ID } });
    if (!listRes.ok) throw new Error(`HITL list failed: ${listRes.status}`);
    const listData = (await listRes.json()) as { data?: { items?: Array<{ id: string; job_id: string }> } };
    const task = listData.data?.items?.find((t) => t.job_id === jobId);
    if (task) {
      const resolveRes = await fetch(`${BASE_URL}/cp/hitl/${task.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_ID },
        body: JSON.stringify({ resolution: { value: 'mock-resolved' } }),
      });
      if (!resolveRes.ok) throw new Error(`HITL resolve failed: ${resolveRes.status} ${await resolveRes.text()}`);
    }
  }

  const { status: final } = await pollUntilStatus(jobId, ['SLOT_FOUND', 'COMPLETED', 'FAILED_TERMINAL', 'FAILED_RETRYABLE'], { timeoutMs: 60_000 });
  if (final !== 'SLOT_FOUND' && final !== 'COMPLETED') {
    throw new Error(`Expected SLOT_FOUND or COMPLETED after HITL, got ${final}`);
  }
  console.log('HITL path OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
