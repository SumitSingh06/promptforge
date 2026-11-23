// Tiny in-memory rate limiter (sliding window).
// On Vercel each serverless instance keeps its own memory, so this is a best-effort
// guard against spam / key misuse, not a hard global limit.

export function createLimiter({ limit = 20, windowMs = 60_000 } = {}) {
  const hits = new Map(); // key -> array of timestamps

  return function check(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
    }
    recent.push(now);
    hits.set(key, recent);

    // occasional cleanup so the Map cannot grow forever
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
    return { ok: true, remaining: limit - recent.length };
  };
}
