import { createApp } from './app.js';
import { getDb, closeDb, SystemSettingsRepository, AuditRepository } from '@visa-automation/db';
import { closeQueue } from './queue/producer.js';
import { startStuckJobRecovery } from './workers/stuck-job-recovery.js';
import { startWatcherWorker } from './workers/watcher.js';

const PORT = parseInt(process.env.CP_PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const AUDIT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

let stopStuckJobRecovery: (() => void) | null = null;
let stopWatcherWorker: (() => void) | null = null;
let stopAuditRetention: (() => void) | null = null;

async function main() {
  const app = await createApp();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    if (stopStuckJobRecovery) {
      stopStuckJobRecovery();
      stopStuckJobRecovery = null;
    }
    if (stopWatcherWorker) {
      stopWatcherWorker();
      stopWatcherWorker = null;
    }
    if (stopAuditRetention) {
      stopAuditRetention();
      stopAuditRetention = null;
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

    const getNextWatcherDelayMs = async (): Promise<number> => {
      const repo = new SystemSettingsRepository(getDb());
      const fixedMs = await repo.getNumber(null, 'system', 'watcher_interval_fixed_ms', 5 * 60 * 1000);
      const jitterMs = await repo.getNumber(null, 'system', 'watcher_interval_jitter_ms', 60 * 1000);
      const delta = (Math.random() * 2 - 1) * jitterMs;
      const delay = Math.max(60_000, Math.round(fixedMs + delta));
      return delay;
    };
    stopWatcherWorker = startWatcherWorker(app.log, getNextWatcherDelayMs);

    const auditRepo = new AuditRepository(getDb());
    const auditRun = async () => {
      const retentionDays = await settingsRepo.getNumber(null, 'audit', 'retention_days', 90);
      const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      try {
        const deleted = await auditRepo.deleteOlderThan(olderThan);
        if (deleted > 0) app.log.info({ deleted, olderThan, retentionDays }, 'Audit retention: pruned old audit logs');
      } catch (err) {
        app.log.warn({ err }, 'Audit retention run failed');
      }
    };
    await auditRun();
    const auditIntervalId = setInterval(auditRun, AUDIT_RETENTION_INTERVAL_MS);
    stopAuditRetention = () => {
      clearInterval(auditIntervalId);
      app.log.info('Audit retention stopped');
    };
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
