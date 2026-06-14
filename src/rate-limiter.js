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
