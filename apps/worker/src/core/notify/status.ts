import { Redis as IORedis } from 'ioredis';

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
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
  // 2 gün tutulması yeterli
  await getRedis().set(`slot_status:${jobId}`, status, 'EX', 2 * 24 * 3600);
}
