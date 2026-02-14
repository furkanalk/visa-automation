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

/**
 * Returns true if this key is "new" (i.e., first time within TTL window).
 * Implementation: SET key "1" NX EX <ttl>
 */
export async function dedupeOnce(args: { key: string; ttlSeconds: number }): Promise<boolean> {
  const r = getRedis();
  const res = await r.set(args.key, '1', 'EX', args.ttlSeconds, 'NX');
  return res === 'OK';
}
