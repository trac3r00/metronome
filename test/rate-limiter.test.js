import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRateLimiter,
  createHttpRateLimiter,
  isRateLimited,
  RATE_LIMIT_MAX_MESSAGES,
  RATE_LIMIT_BLOCK_MS,
  RATE_LIMIT_WINDOW_MS,
} from "../src/rate-limiter.js";

describe("createHttpRateLimiter middleware", () => {
  it("passes requests through when under the limit", () => {
    const middleware = createHttpRateLimiter();
    let nextCalled = false;
    const request = { ip: "127.0.0.1" };
    const response = {};
    middleware(request, response, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("returns 429 when a single IP exceeds the rate limit", () => {
    const middleware = createHttpRateLimiter();
    let statusCode = null;
    let body = null;
    const request = { ip: "10.0.0.1" };
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        body = data;
      },
    };

    // Exhaust the per-window allowance.
    for (let index = 0; index < RATE_LIMIT_MAX_MESSAGES; index += 1) {
      let called = false;
      middleware(request, response, () => {
        called = true;
      });
      assert.equal(called, true, `request ${index + 1} should pass`);
    }

    // The next request should be rejected.
    let nextCalledAfterLimit = false;
    middleware(request, response, () => {
      nextCalledAfterLimit = true;
    });
    assert.equal(nextCalledAfterLimit, false);
    assert.equal(statusCode, 429);
    assert.match(body.error, /Rate limit/);
  });

  it("isolates rate limits per IP address", () => {
    const middleware = createHttpRateLimiter();
    const fakeResponse = {
      status() {
        return this;
      },
      json() {},
    };

    // Exhaust the limit for IP A.
    for (let index = 0; index <= RATE_LIMIT_MAX_MESSAGES; index += 1) {
      middleware({ ip: "10.0.0.1" }, fakeResponse, () => {});
    }

    // IP B should still be allowed.
    let nextCalled = false;
    middleware({ ip: "10.0.0.2" }, fakeResponse, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("falls back to socket.remoteAddress when request.ip is absent", () => {
    const middleware = createHttpRateLimiter();
    let nextCalled = false;
    const request = { socket: { remoteAddress: "192.168.1.1" } };
    const response = {};
    middleware(request, response, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});

describe("isRateLimited (unit)", () => {
  it("allows up to MAX_MESSAGES in one window", () => {
    const limiter = createRateLimiter();
    const now = 1000;
    for (let index = 0; index < RATE_LIMIT_MAX_MESSAGES; index += 1) {
      assert.equal(isRateLimited(limiter, now), false, `message ${index + 1} should pass`);
    }
    assert.equal(isRateLimited(limiter, now), true, "first excess message should be limited");
  });

  it("resets after the window elapses", () => {
    const limiter = createRateLimiter();
    const now = 1000;
    for (let index = 0; index <= RATE_LIMIT_MAX_MESSAGES; index += 1) {
      isRateLimited(limiter, now);
    }
    // After the block period + window, requests should be allowed again.
    const afterBlock = now + RATE_LIMIT_BLOCK_MS + RATE_LIMIT_WINDOW_MS + 1;
    assert.equal(isRateLimited(limiter, afterBlock), false);
  });
});
