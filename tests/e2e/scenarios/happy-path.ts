/** E2E Happy path: create job, mock returns slots, assert SLOT_FOUND or COMPLETED. Run: npm run e2e:happy */
import { createJob, getJobStatus, pollUntilStatus, setMockPortalConfig, resetMockPortal } from '../helpers.js';

const MOCK_DATES = ['2026-03-15', '2026-03-16'];

async function main() {
  await resetMockPortal();
  await setMockPortalConfig('as-visa', {
    enabled: true,
    behavior: { pageLoadDelayMs: 100, formSubmitDelayMs: 200, slotSearchDelayMs: 200, randomDelayMs: 0, errorRate: 0, maintenanceMode: false },
    captcha: { enabled: false, autoSolveDelayMs: 0, failRate: 0 },
    slots: { availableDates: MOCK_DATES, availableTimes: ['09:00', '10:00'], randomizeAvailability: false, slotDisappearChance: 0 },
  });

  const jobId = await createJob();
  console.log('Created job', jobId);

  const { status } = await pollUntilStatus(jobId, ['SLOT_FOUND', 'COMPLETED', 'FAILED_TERMINAL', 'FAILED_RETRYABLE']);
  if (status !== 'SLOT_FOUND' && status !== 'COMPLETED') {
    const current = await getJobStatus(jobId);
    throw new Error('Expected SLOT_FOUND or COMPLETED, got ' + status + ' ' + JSON.stringify(current));
  }
  console.log('Happy path OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
