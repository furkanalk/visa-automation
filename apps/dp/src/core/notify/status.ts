import { Redis as IORedis } from 'ioredis';

let redis: IORedis | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

function getRedis(): IORedis {
  if (!redis) {
    const host = requireEnv('REDIS_HOST');
    const port = parseInt(requireEnv('REDIS_PORT'), 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error('REDIS_PORT must be a valid port number (1-65535).');
    }
    redis = new IORedis({
      host,
      port,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

export type SlotStatus = 'open' | 'closed';

export async function getSlotStatus(jobId: string): Promise<SlotStatus | null> {
  const v = await getRedis().get(`slot_status:${jobId}`);
  return v === 'open' || v === 'closed' ? v : null;
}

export async function setSlotStatus(jobId: string, status: SlotStatus): Promise<void> {
  // keep for 2 days
  await getRedis().set(`slot_status:${jobId}`, status, 'EX', 2 * 24 * 3600);
}
