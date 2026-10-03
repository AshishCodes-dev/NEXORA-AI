/**
 * Focused In-Memory Rate Limiting Middleware
 * 
 * Protects authentication-sensitive endpoints from brute-force floods
 * without requiring external Redis/Memcached dependencies.
 * Automatically cleans up expired IP buckets to prevent memory accumulation.
 */

/**
 * Creates an Express rate-limiter middleware instance.
 * 
 * @param {object} [options={}]
 * @param {number} [options.windowMs=900000] - Window duration in ms (default: 15 minutes)
 * @param {number} [options.max=20] - Maximum requests allowed per window
 * @param {string} [options.message='Too many authentication attempts. Please try again later.']
 * @param {function} [options.keyGenerator] - Optional custom key generator
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 20;
  const message = options.message || 'Too many authentication attempts. Please try again later.';
  const keyGenerator = options.keyGenerator || ((req) => {
    return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  });

  // In-memory store: IP -> { count: number, resetTime: number }
  const hits = new Map();

  // Periodic cleanup to avoid memory leak from stale IPs
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

module.exports = {
  createRateLimiter,
  authRateLimiter,
};
