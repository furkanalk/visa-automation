import { Redis as IORedis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import { pino } from 'pino';
import { closeDb } from '@visa-automation/db';
import { closeBrowser } from './core/browser/browser-manager.js';
import { AgentPool, AsyncAgentRunner, SyncAgentRunner } from './agent-pool/index.js';
import { processJob } from './processor.js';
import { getConfigService, type ConfigService } from './config/config-service.js';
import './portals/as-visa/index.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const LOG_LEVEL = LOG_LEVELS.includes(process.env.LOG_LEVEL as (typeof LOG_LEVELS)[number])
  ? (process.env.LOG_LEVEL as (typeof LOG_LEVELS)[number])
  : 'info';

const logger = pino({
  level: LOG_LEVEL,
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

// Core configuration from environment (cannot be overridden from DB)
const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const TENANT_ID = process.env.TENANT_ID ?? 'default';
const CP_API_URL = process.env.CP_API_URL ?? 'http://localhost:3001';
const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? 'http://localhost:3000';

// These can be overridden from DB config (env vars take precedence if set)
const envAsyncAgentCount = process.env.ASYNC_AGENT_COUNT ? parseInt(process.env.ASYNC_AGENT_COUNT, 10) : null;
const envSyncAgentCount = process.env.SYNC_AGENT_COUNT ? parseInt(process.env.SYNC_AGENT_COUNT, 10) : null;
const envHeartbeatIntervalMs = process.env.HEARTBEAT_INTERVAL_MS ? parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) : null;
const envConfigRefreshIntervalMs = process.env.CONFIG_REFRESH_INTERVAL_MS ? parseInt(process.env.CONFIG_REFRESH_INTERVAL_MS, 10) : null;
const envSyncPollIntervalMs = process.env.SYNC_POLL_INTERVAL_MS ? parseInt(process.env.SYNC_POLL_INTERVAL_MS, 10) : null;
const envMaxAgents = process.env.MAX_AGENTS ? parseInt(process.env.MAX_AGENTS, 10) : null;

let configService: ConfigService | null = null;
let agentPool: AgentPool | null = null;
let asyncRunner: AsyncAgentRunner | null = null;
let syncRunner: SyncAgentRunner | null = null;
let redisConnection: RedisType | null = null;

function getRedisConnection(): RedisType {
  if (!redisConnection) {
    redisConnection = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
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
    logger.info('ConfigService initialized, using DB config where available');
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize ConfigService, using defaults');
  }

  // Get config values (env vars override DB values)
  const systemConfig = configService.get('system');
  const ASYNC_AGENT_COUNT = envAsyncAgentCount ?? systemConfig.default_async_agent_count;
  const SYNC_AGENT_COUNT = envSyncAgentCount ?? systemConfig.default_sync_agent_count;
  const HEARTBEAT_INTERVAL_MS = envHeartbeatIntervalMs ?? systemConfig.heartbeat_interval_ms;
  const CONFIG_REFRESH_INTERVAL_MS = envConfigRefreshIntervalMs ?? systemConfig.config_refresh_interval_ms;
  const SYNC_POLL_INTERVAL_MS = envSyncPollIntervalMs ?? systemConfig.sync_poll_interval_ms;
  const MAX_AGENTS = envMaxAgents ?? systemConfig.max_agents_per_worker;

  logger.info({
    workerId: WORKER_ID,
    tenantId: TENANT_ID,
    cpApiUrl: CP_API_URL,
    publicApiUrl: PUBLIC_API_URL,
    asyncAgents: ASYNC_AGENT_COUNT,
    syncAgents: SYNC_AGENT_COUNT,
    heartbeatInterval: HEARTBEAT_INTERVAL_MS,
    configRefreshInterval: CONFIG_REFRESH_INTERVAL_MS,
    configSource: configService.isStale(60000) ? 'defaults' : 'db',
  }, 'Starting worker with AgentPool');

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

  logger.info({ 
    hydrated: hydratedStats, 
    needAsync: needAsyncAgents, 
    needSync: needSyncAgents 
  }, 'Agent counts after hydration');

  // Create additional ASYNC agents if needed
  for (let i = 0; i < needAsyncAgents; i++) {
    try {
      await agentPool.createAgent({
        name: `${WORKER_ID}-async-${hydratedStats.asyncCount + i + 1}`,
        mode: 'ASYNC',
      });
    } catch (err) {
      logger.error({ err, agentNum: i + 1 }, 'Failed to create async agent');
    }
  }

  // Create additional SYNC agents if needed
  for (let i = 0; i < needSyncAgents; i++) {
    try {
      await agentPool.createAgent({
        name: `${WORKER_ID}-sync-${hydratedStats.syncCount + i + 1}`,
        mode: 'SYNC',
      });
    } catch (err) {
      logger.error({ err, agentNum: i + 1 }, 'Failed to create sync agent');
    }
  }

  const finalStats = agentPool.getStats();
  logger.info(finalStats, 'Final agent pool stats');

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

  logger.info('Worker started, waiting for jobs...');
}

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

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

  if (agentPool) {
    await agentPool.shutdown();
  }

  if (redisConnection) {
    await redisConnection.quit();
  }

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
