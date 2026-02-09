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

/**
 * Returns true if this key is "new" (i.e., first time within TTL window).
 * Implementation: SET key "1" NX EX <ttl>
 */
export async function dedupeOnce(args: { key: string; ttlSeconds: number }): Promise<boolean> {
  const r = getRedis();
  const res = await r.set(args.key, '1', 'EX', args.ttlSeconds, 'NX');
  return res === 'OK';
}
