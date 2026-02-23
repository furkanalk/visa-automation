import { Redis as IORedis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import { pino } from 'pino';
import { closeDb } from '@visa-automation/db';
import { closeBrowser } from './core/browser/browser-manager.js';
import { closeQueue } from './core/queue/queue.js';
import { AgentPool, AsyncAgentRunner, SyncAgentRunner, ScoutAgentRunner } from './agent-pool/index.js';
import { processJob } from './processor.js';
import { getConfigService, type ConfigService } from './config/config-service.js';
import { startHealthServer } from './core/observability/health-server.js';
import './portals/as-visa/index.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const LOG_LEVEL = LOG_LEVELS.includes(process.env.LOG_LEVEL as (typeof LOG_LEVELS)[number])
  ? (process.env.LOG_LEVEL as (typeof LOG_LEVELS)[number])
  : 'info';

const logger = pino({
  level: LOG_LEVEL,
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

// Core configuration from environment (cannot be overridden from DB)
const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const TENANT_ID = requireEnv('TENANT_ID');
const CP_API_URL = requireEnv('CP_API_URL');
const PUBLIC_API_URL = requireEnv('PUBLIC_API_URL');

const DP_HEALTH_PORT = parseInt(process.env.DP_HEALTH_PORT ?? '3010', 10);

let configService: ConfigService | null = null;
let agentPool: AgentPool | null = null;
let asyncRunner: AsyncAgentRunner | null = null;
let syncRunner: SyncAgentRunner | null = null;
let scoutRunner: ScoutAgentRunner | null = null;
let redisConnection: RedisType | null = null;
let healthServerClose: (() => Promise<void>) | null = null;

function getRedisConnection(): RedisType {
  if (!redisConnection) {
    const host = requireEnv('REDIS_HOST');
    const port = parseInt(requireEnv('REDIS_PORT'), 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error('REDIS_PORT must be a valid port number (1-65535).');
    }
    redisConnection = new IORedis({
      host,
      port,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    });
  }
  return redisConnection;
}

async function main() {
  // Initialize ConfigService to fetch settings from CP
  configService = getConfigService({
    cpApiUrl: CP_API_URL,
    tenantId: TENANT_ID,
    logger,
  });
  
  try {
    await configService.initialize();
  } catch (err) {
    logger.error({ err }, 'ConfigService failed to load config from CP. Ensure migrations (010_system_settings) and CP are up.');
    throw err;
  }

  const systemConfig = configService.get('system');
  const ASYNC_AGENT_COUNT = systemConfig.default_async_agent_count;
  const SYNC_AGENT_COUNT = systemConfig.default_sync_agent_count;
  const SCOUT_AGENT_COUNT = systemConfig.default_scout_agent_count ?? 0;
  const HEARTBEAT_INTERVAL_MS = systemConfig.heartbeat_interval_ms;
  const CONFIG_REFRESH_INTERVAL_MS = systemConfig.config_refresh_interval_ms;
  const SYNC_POLL_INTERVAL_MS = systemConfig.sync_poll_interval_ms;
  const MAX_AGENTS = systemConfig.max_agents_per_worker;

  logger.info({ workerId: WORKER_ID, asyncAgents: ASYNC_AGENT_COUNT, syncAgents: SYNC_AGENT_COUNT, scoutAgents: SCOUT_AGENT_COUNT }, 'DP worker starting');

  // Initialize AgentPool
  agentPool = new AgentPool({
    tenantId: TENANT_ID,
    workerId: WORKER_ID,
    cpApiUrl: CP_API_URL,
    publicApiUrl: PUBLIC_API_URL,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    configRefreshIntervalMs: CONFIG_REFRESH_INTERVAL_MS,
    syncPollIntervalMs: SYNC_POLL_INTERVAL_MS,
    maxAgents: MAX_AGENTS,
  }, logger);

  await agentPool.initialize();

  // Start auto-refresh for config
  configService.startAutoRefresh(CONFIG_REFRESH_INTERVAL_MS);

  // Check how many agents already hydrated from CP
  const hydratedStats = agentPool.getStats();
  const needAsyncAgents = Math.max(0, ASYNC_AGENT_COUNT - hydratedStats.asyncCount);
  const needSyncAgents = Math.max(0, SYNC_AGENT_COUNT - hydratedStats.syncCount);
  const needScoutAgents = Math.max(0, SCOUT_AGENT_COUNT - hydratedStats.scoutCount);

  logger.debug({ hydrated: hydratedStats, needAsync: needAsyncAgents, needSync: needSyncAgents, needScout: needScoutAgents }, 'Agent counts after hydration');

  const agentName = (index: number) =>
    WORKER_ID === 'worker-1'
      ? `visor-agent-${index}`
      : `visor-agent-${WORKER_ID}-${index}`;
  const scoutAgentName = (index: number) =>
    WORKER_ID === 'worker-1'
      ? `visor-scout-${index}`
      : `visor-scout-${WORKER_ID}-${index}`;

  for (let i = 0; i < needAsyncAgents; i++) {
    try {
      await agentPool.createAgent({
        name: agentName(hydratedStats.asyncCount + i + 1),
        mode: 'ASYNC',
      });
    } catch (err) {
      logger.error({ err, agentNum: i + 1 }, 'Failed to create async agent');
    }
  }

  for (let i = 0; i < needSyncAgents; i++) {
    try {
      await agentPool.createAgent({
        name: agentName(hydratedStats.asyncCount + hydratedStats.syncCount + i + 1),
        mode: 'SYNC',
      });
    } catch (err) {
      logger.error({ err, agentNum: i + 1 }, 'Failed to create sync agent');
    }
  }

  let scoutProfileId: string | null = null;
  if (needScoutAgents > 0) {
    scoutProfileId = await agentPool.getCPClient().getScoutProfileId();
    if (!scoutProfileId) {
      logger.warn('Scout agent count > 0 but no Scout profile found in CP; create a profile with is_scout=true and create scout agents');
    }
  }
  for (let i = 0; i < needScoutAgents; i++) {
    if (!scoutProfileId) break;
    try {
      await agentPool.createAgent({
        name: scoutAgentName(hydratedStats.scoutCount + i + 1),
        mode: 'ASYNC',
        profileId: scoutProfileId,
      });
    } catch (err) {
      logger.error({ err, scoutNum: i + 1 }, 'Failed to create scout agent');
    }
  }

  const finalStats = agentPool.getStats();
  logger.debug(finalStats, 'Final agent pool stats');

  const health = startHealthServer(DP_HEALTH_PORT, {
    cpHealthCheck: () => agentPool!.getCPClient().healthCheck(),
  });
  healthServerClose = health.close;

  // Start AsyncAgentRunner (for queue-based job processing)
  if (finalStats.asyncCount > 0) {
    asyncRunner = new AsyncAgentRunner({
      agentPool,
      redis: getRedisConnection(),
      logger,
      workerId: WORKER_ID,
      processJob,
    });
    await asyncRunner.start();
  }

  // Start SyncAgentRunner (for CP-triggered job processing)
  if (finalStats.syncCount > 0) {
    syncRunner = new SyncAgentRunner({
      agentPool,
      logger,
      workerId: WORKER_ID,
      pollIntervalMs: SYNC_POLL_INTERVAL_MS,
      processJob,
    });
    await syncRunner.start();
  }

  // Slot-check queue is consumed only by scout agents
  scoutRunner = new ScoutAgentRunner({
    agentPool,
    redis: getRedisConnection(),
    logger,
    workerId: WORKER_ID,
    processJob,
    useFallbackToAsyncAgents: false,
  });
  await scoutRunner.start();

  logger.info({ workerId: WORKER_ID, asyncCount: finalStats.asyncCount, syncCount: finalStats.syncCount, scoutCount: finalStats.scoutCount }, 'DP worker ready');
}

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  if (healthServerClose) {
    await healthServerClose();
    healthServerClose = null;
  }

  // Stop config auto-refresh
  if (configService) {
    configService.stopAutoRefresh();
  }

  if (asyncRunner) {
    await asyncRunner.stop();
  }

  if (syncRunner) {
    await syncRunner.stop();
  }

  if (scoutRunner) {
    await scoutRunner.stop();
  }

  if (agentPool) {
    await agentPool.shutdown();
  }

  if (redisConnection) {
    await redisConnection.quit();
  }

  await closeQueue();
  await closeBrowser();
  await closeDb();

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  logger.error({ err }, 'Failed to start worker');
  process.exit(1);
});
