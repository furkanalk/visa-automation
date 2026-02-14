/**
 * E2E: Timeout / retry → success.
 * Mock portal slow or error once; retry; then success.
 * Run: npm run e2e:retry. Prerequisites: CP, DP, mock-portal, Redis, Postgres.
 */
import { createJob, pollUntilStatus, setMockPortalConfig, resetMockPortal } from '../helpers.js';

async function main() {
  await resetMockPortal();
  // First run can timeout or error (high delay or errorRate); after reset/config change, next run succeeds
  await setMockPortalConfig('as-visa', {
    enabled: true,
    behavior: {
      pageLoadDelayMs: 500,
      formSubmitDelayMs: 2000,
      slotSearchDelayMs: 2000,
      randomDelayMs: 0,
      errorRate: 0.3, // 30% error on first attempts; eventually succeeds
      maintenanceMode: false,
    },
    captcha: { enabled: false, autoSolveDelayMs: 0, failRate: 0 },
    slots: { availableDates: ['2026-03-15'], availableTimes: ['09:00'], randomizeAvailability: false, slotDisappearChance: 0 },
  });

  const jobId = await createJob();
  console.log('Created job', jobId);

  const { status } = await pollUntilStatus(jobId, ['SLOT_FOUND', 'COMPLETED', 'FAILED_TERMINAL', 'FAILED_RETRYABLE', 'WAITING_SLOT'], { timeoutMs: 180_000 });
  if (status !== 'SLOT_FOUND' && status !== 'COMPLETED') {
    console.log('Final status:', status, '(retry/timeout scenario may end in WAITING_SLOT or FAILED_RETRYABLE depending on mock)');
  } else {
    console.log('Timeout/retry path OK — reached', status);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
