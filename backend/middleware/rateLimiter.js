/**
 * Focused In-Memory Rate Limiting Middleware
 *
 * Protects authentication-sensitive endpoints and mission creation from floods
 * without requiring external Redis/Memcached dependencies.
 * Automatically cleans up expired IP/user buckets to prevent memory accumulation.
 */

/**
 * Resolves client IP address taking into account Express reverse-proxy trust configuration.
 * When proxy is NOT trusted, ignores forwarded headers to prevent IP spoofing.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveClientIp(req) {
  const isProxyTrusted = Boolean(req.app && req.app.get && req.app.get('trust proxy'));
  if (isProxyTrusted && req.ip) {
    return req.ip;
  }
  // When proxy is not explicitly trusted, derive strictly from socket connection
  return req.socket?.remoteAddress || req.ip || 'unknown-client';
}

/**
 * Creates an Express rate-limiter middleware instance.
 *
 * NOTE: This is an in-memory rate limiter scoped to the local Node process.
 * It does not share rate-limit buckets across horizontal multi-replica deployments.
 *
 * @param {object} [options={}]
 * @param {number} [options.windowMs=900000] - Window duration in ms (default: 15 minutes)
 * @param {number} [options.max=20] - Maximum requests allowed per window
 * @param {string} [options.message='Too many requests. Please try again later.']
 * @param {function} [options.keyGenerator] - Optional custom key generator
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 20;
  const message = options.message || 'Too many requests. Please try again later.';
  const keyGenerator = options.keyGenerator || ((req) => {
    return resolveClientIp(req);
  });

  // In-memory store: Key -> { count: number, resetTime: number }
  const hits = new Map();

  // Periodic cleanup to avoid memory leak from stale keys
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, Math.min(windowMs, 5 * 60 * 1000));

  // Ensure interval does not prevent Node process termination
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  const limiterMiddleware = (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req);

    let record = hits.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil(record.resetTime / 1000);
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));

    // Standard RFC-compliant rate-limit headers
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (record.count > max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        success: false,
        error: message,
        message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: retryAfterSeconds,
      });
    }

    next();
  };

  // Helper method for unit tests to reset store
  limiterMiddleware.reset = () => {
    hits.clear();
  };

  // Helper method to clear timers and release resources
  limiterMiddleware.destroy = () => {
    clearInterval(cleanupInterval);
    hits.clear();
  };

  // Helper method for unit tests to inspect current store
  limiterMiddleware._getStore = () => hits;

  return limiterMiddleware;
}

// Default authentication rate limiter: 25 attempts per 15 minutes
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: 'Too many authentication attempts. Please try again later.',
});

/**
 * Resolves mission rate limiting configuration from environment.
 *
 * @param {object} [env=process.env]
 * @returns {{ windowMs: number, max: number }}
 */
function getMissionRateLimiterConfig(env = process.env) {
  const parsedWindow = env.MISSION_RATE_LIMIT_WINDOW_MS ? parseInt(env.MISSION_RATE_LIMIT_WINDOW_MS, 10) : NaN;
  const parsedMax = env.MISSION_RATE_LIMIT_MAX ? parseInt(env.MISSION_RATE_LIMIT_MAX, 10) : NaN;

  return {
    windowMs: Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : 15 * 60 * 1000,
    max: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 15,
  };
}

/**
 * Derives mission rate limit key: authenticated user ID takes precedence, falling back to safe client IP.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function missionKeyGenerator(req) {
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${resolveClientIp(req)}`;
}

/**
 * Factory for creating configured mission creation rate limiters.
 *
 * @param {object} [options={}]
 * @returns {import('express').RequestHandler}
 */
function createMissionRateLimiter(options = {}) {
  const config = getMissionRateLimiterConfig(options.env || process.env);
  return createRateLimiter({
    windowMs: options.windowMs || config.windowMs,
    max: options.max || config.max,
    message: 'Too many mission creation requests. Please try again later.',
    keyGenerator: options.keyGenerator || missionKeyGenerator,
  });
}

// Default mission creation rate limiter
const missionRateLimiter = createMissionRateLimiter();

module.exports = {
  createRateLimiter,
  authRateLimiter,
  missionRateLimiter,
  createMissionRateLimiter,
  resolveClientIp,
  getMissionRateLimiterConfig,
  missionKeyGenerator,
};
