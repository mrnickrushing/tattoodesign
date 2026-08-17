// Minimal in-memory rate limiter. /api/generate is public and unauthenticated
// but calls a paid Gemini API, so it needs some abuse guard even without a
// login system. In-memory is good enough for a single-instance deployment
// (this app runs as one Railway service, not a multi-region edge function) —
// it resets on redeploy, which is an acceptable tradeoff for a hobby app,
// not a bank.

type Bucket = { count: number; windowStart: number };

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 15;

const buckets = new Map<string, Bucket>();

// Bound memory: sweep stale buckets occasionally instead of growing forever.
let lastSweep = Date.now();
function sweepIfDue(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the caller can retry, only set when not allowed. */
  retryAfterSeconds?: number;
};

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  sweepIfDue(now);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  bucket.count += 1;
  return { allowed: true };
}

/** Best-effort client identifier behind Railway's proxy. */
export function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
