export type RateLimitOptions = {
  capacity?: number;
  refillPerMinute?: number;
};

type Bucket = {
  tokens: number;
  updatedAtMs: number;
  lastSeenAtMs: number;
};

const DEFAULT_CAPACITY = 10;
const DEFAULT_REFILL_PER_MINUTE = 10;
const STALE_BUCKET_MS = 60 * 60 * 1_000;
const PRUNE_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * These buckets live only in this process. Serverless instances do not share
 * limits, and restarting an instance resets its buckets; use a shared store or
 * edge limiter when a deployment-wide limit is required.
 */
const buckets = new Map<string, Bucket>();
let lastPruneAtMs = 0;

function pruneStaleBuckets(nowMs: number) {
  if (nowMs - lastPruneAtMs < PRUNE_INTERVAL_MS) return;

  const staleBeforeMs = nowMs - STALE_BUCKET_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.lastSeenAtMs <= staleBeforeMs) {
      buckets.delete(key);
    }
  }
  lastPruneAtMs = nowMs;
}

export function rateLimit(
  key: string,
  options: RateLimitOptions = {},
  nowMs = Date.now(),
): boolean {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const refillPerMinute = options.refillPerMinute ?? DEFAULT_REFILL_PER_MINUTE;

  if (
    !Number.isFinite(capacity) ||
    capacity <= 0 ||
    !Number.isFinite(refillPerMinute) ||
    refillPerMinute <= 0 ||
    !Number.isFinite(nowMs)
  ) {
    return false;
  }

  pruneStaleBuckets(nowMs);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, updatedAtMs: nowMs, lastSeenAtMs: nowMs };
    buckets.set(key, bucket);
  } else {
    const elapsedMs = Math.max(0, nowMs - bucket.updatedAtMs);
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + (elapsedMs / 60_000) * refillPerMinute,
    );
    bucket.updatedAtMs = Math.max(bucket.updatedAtMs, nowMs);
    bucket.lastSeenAtMs = nowMs;
  }

  if (bucket.tokens < 1) return false;

  bucket.tokens -= 1;
  return true;
}

export function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
