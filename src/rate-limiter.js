export const RATE_LIMIT_WINDOW_MS = 1000;
export const RATE_LIMIT_MAX_MESSAGES = 60;
export const RATE_LIMIT_BLOCK_MS = 1000;

export function createRateLimiter() {
  return {
    windowStartedAt: 0,
    messageCount: 0,
    blockedUntil: 0,
  };
}

export function isRateLimited(limiter, now = Date.now()) {
  if (now < limiter.blockedUntil) {
    return true;
  }
  if (now - limiter.windowStartedAt > RATE_LIMIT_WINDOW_MS) {
    limiter.windowStartedAt = now;
    limiter.messageCount = 0;
  }
  limiter.messageCount += 1;
  if (limiter.messageCount <= RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }
  limiter.blockedUntil = now + RATE_LIMIT_BLOCK_MS;
  return true;
}

/**
 * Express middleware that rate-limits mutating HTTP endpoints per client IP.
 * Uses the same token-bucket algorithm as the WebSocket path so both surfaces
 * share identical abuse thresholds.
 */
export function createHttpRateLimiter() {
  const limiters = new Map();
  return (request, response, next) => {
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
    let limiter = limiters.get(ip);
    if (!limiter) {
      limiter = createRateLimiter();
      limiters.set(ip, limiter);
    }
    if (isRateLimited(limiter)) {
      response.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      return;
    }
    next();
  };
}
