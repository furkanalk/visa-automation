/**
 * Concurrency test: multiple workers try to acquire lock on the same QUEUED job.
 * Expectation: exactly one acquireLock returns true, others false.
 * Requires: Postgres (DB_* env), migrations and seed run (default tenant exists).
 */
import { getDb, JobRepository } from '@visa-automation/db';
import { JOB_STATES } from '@visa-automation/shared';

const DEFAULT_TENANT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; // from seed
const CONCURRENCY = 20;
const LOCK_DURATION_MS = 60_000;

async function main() {
  const db = getDb();
  const jobRepo = new JobRepository(db);

  // Create one QUEUED job
  const job = await jobRepo.create({
    tenant_id: DEFAULT_TENANT_ID,
    external_ref: null,
    visa_type: 'SCHENGEN',
    status: JOB_STATES.QUEUED,
    priority: 50,
    applicant_data: { name: 'Claim test' },
    config: {},
    retry_count: 0,
    max_retries: 3,
  });

  const jobId = job.id;
  console.log('Created job', jobId, '- running', CONCURRENCY, 'concurrent acquireLock...');

  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      jobRepo.acquireLock(jobId, `worker-${i}`, LOCK_DURATION_MS)
    )
  );

  const won = results.filter(Boolean).length;
  if (won !== 1) {
    console.error('FAIL: expected exactly 1 lock acquired, got', won);
    process.exit(1);
  }

  console.log('PASS: exactly one worker acquired the lock');
  await db.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
