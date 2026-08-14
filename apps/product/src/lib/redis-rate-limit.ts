import { Redis } from '@upstash/redis';

const RATE_LIMIT_PREFIX = 'ratelimit:';

export type RedisRateLimitOptions = {
  capacity?: number;
  refillPerMinute?: number;
};

export interface RateLimiter {
  check(key: string, options?: RedisRateLimitOptions): Promise<boolean>;
}

function createRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redisClient = createRedisClient();

export function isRedisRateLimitConfigured(): boolean {
  return redisClient !== null;
}

async function redisRateLimit(
  key: string,
  options: RedisRateLimitOptions = {},
): Promise<boolean> {
  const client = redisClient;
  if (!client) return false;

  const capacity = options.capacity ?? 10;
  const windowMs = 60_000;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowKey = `${RATE_LIMIT_PREFIX}${key}:${Math.floor(nowSec / (windowMs / 1000))}`;

  const current = await client.incr(windowKey);
  if (current === 1) {
    await client.pexpire(windowKey, windowMs);
  }

  return current <= capacity;
}

export const distributedRateLimiter: RateLimiter = {
  async check(key: string, options?: RedisRateLimitOptions): Promise<boolean> {
    if (isRedisRateLimitConfigured()) {
      return redisRateLimit(key, options);
    }
    return false;
  },
};

export async function rateLimitWithFallback(
  key: string,
  options: RedisRateLimitOptions = {},
): Promise<boolean> {
  if (await distributedRateLimiter.check(key, options)) {
    return true;
  }

  const { rateLimit: localRateLimit } = await import('./rate-limit');
  return localRateLimit(key, options);
}