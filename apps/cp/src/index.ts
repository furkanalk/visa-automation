import { createApp } from './app.js';
import { getDb, closeDb, SystemSettingsRepository } from '@visa-automation/db';
import { closeQueue } from './queue/producer.js';
import { startStuckJobRecovery } from './workers/stuck-job-recovery.js';

const PORT = parseInt(process.env.CP_PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

let stopStuckJobRecovery: (() => void) | null = null;

async function main() {
  const app = await createApp();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    if (stopStuckJobRecovery) {
      stopStuckJobRecovery();
      stopStuckJobRecovery = null;
    }
    await app.close();
    await closeQueue();
    await closeDb();

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Control Plane API listening on ${HOST}:${PORT}`);

    const settingsRepo = new SystemSettingsRepository(getDb());
    const intervalMs = await settingsRepo.getNumber(null, 'system', 'stuck_job_recovery_interval_ms', 60_000);
    stopStuckJobRecovery = startStuckJobRecovery(app.log, intervalMs);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
