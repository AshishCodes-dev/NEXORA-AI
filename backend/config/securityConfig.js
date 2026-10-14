const helmet = require('helmet');

/**
 * Validates whether a given string is a valid HTTP or HTTPS origin URL.
 * Origin must have protocol, host, and optional port, but NO path or query.
 * Wildcard '*' is strictly prohibited for credentialed CORS.
 *
 * @param {string} origin
 * @returns {boolean}
 */
function isValidOriginUrl(origin) {
  if (typeof origin !== 'string' || !origin.trim()) return false;
  const trimmed = origin.trim();

  // Wildcard is strictly forbidden for credentialed CORS
  if (trimmed === '*') return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    // Origin cannot have a sub-path other than '/'
    if (parsed.pathname && parsed.pathname !== '/') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes an origin string by trimming whitespace and removing trailing slashes.
 *
 * @param {string} origin
 * @returns {string}
 */
function normalizeOrigin(origin) {
  return origin.trim().replace(/\/+$/, '');
}

/**
 * Resolves and validates allowed origins from environment configuration.
 *
 * Precedence:
 * 1. CORS_ORIGIN (can be comma-separated list of origins)
 * 2. FRONTEND_URL (can be single or comma-separated list of origins)
 *
 * Rules:
 * - In production: At least one valid origin MUST be explicitly configured.
 *   Throws an error if missing, empty, or containing invalid URLs/wildcards.
 *   Does NOT fall back to localhost or wildcards.
 * - In development/test: Defaults to ['http://localhost:5173', 'http://127.0.0.1:5173'].
 *   If environment variable is provided, combines configured origins with dev defaults.
 *
 * @param {object} [env=process.env]
 * @returns {Array<string>} Array of validated, normalized origin strings
 */
function resolveAllowedOrigins(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const rawConfig = env.CORS_ORIGIN || env.FRONTEND_URL || '';
  const parsedOrigins = rawConfig
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (isProduction) {
    if (parsedOrigins.length === 0) {
      throw new Error(
        '[SECURITY CONFIG ERROR] CORS_ORIGIN or FRONTEND_URL must be configured in production. Localhost fallback is prohibited.'
      );
    }

    const validated = [];
    for (const origin of parsedOrigins) {
      if (!isValidOriginUrl(origin)) {
        throw new Error(
          `[SECURITY CONFIG ERROR] Invalid origin configured for production CORS: '${origin}'. Must be valid http(s) URL and cannot be '*'.`
        );
      }
      validated.push(normalizeOrigin(origin));
    }

    return Array.from(new Set(validated));
  }

  // Development / Test environment defaults
  const devDefaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  if (parsedOrigins.length === 0) {
    return devDefaults;
  }

  const validated = [...devDefaults];
  for (const origin of parsedOrigins) {
    if (isValidOriginUrl(origin)) {
      validated.push(normalizeOrigin(origin));
    }
  }

  return Array.from(new Set(validated));
}

/**
 * Creates configurable CORS middleware enforcing credentialed cross-origin access.
 *
 * @param {object} [options={}]
 * @param {object} [options.env=process.env]
 * @returns {import('express').RequestHandler}
 */
function createCorsMiddleware(options = {}) {
  const env = options.env || process.env;
  const allowedOrigins = resolveAllowedOrigins(env);

  return (req, res, next) => {
    const origin = req.headers.origin;

    // 1. Non-browser / same-origin / healthcheck requests (no Origin header)
    if (!origin) {
      return next();
    }

    const normalizedOrigin = normalizeOrigin(origin);

    // 2. Origin validation
    if (allowedOrigins.includes(normalizedOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      return next();
    }

    // 3. Reject unapproved cross-origin requests
    if (req.method === 'OPTIONS') {
      return res.status(403).json({
        success: false,
        error: 'CORS origin not allowed',
      });
    }

    return res.status(403).json({
      success: false,
      error: 'CORS origin not allowed',
    });
  };
}

/**
 * Creates Helmet middleware configured safely for NEXORA JSON API.
 *
 * - Enables HSTS strictly in production (disabled in dev/test to allow local HTTP).
 * - Implements practical Content Security Policy with connectSrc matching allowed origins.
 * - Configures nosniff, frame denial (clickjacking defense), and safe cross-origin resource policy.
 *
 * @param {object} [options={}]
 * @param {object} [options.env=process.env]
 * @returns {import('express').RequestHandler}
 */
function createHelmetMiddleware(options = {}) {
  const env = options.env || process.env;
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  let allowedOrigins = [];
  try {
    allowedOrigins = resolveAllowedOrigins(env);
  } catch {
    allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  return helmet({
    // HSTS only enabled in production HTTPS
    hsts: isProduction
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,

    // Practical CSP compatible with NEXORA frontend and development tooling
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", ...allowedOrigins],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },

    // Allow frontend to load cross-origin API responses
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
  });
}

/**
 * Startup validator to fail-fast if security preconditions are not met in production.
 *
 * @param {object} [env=process.env]
 */
function validateSecurityConfig(env = process.env) {
  resolveAllowedOrigins(env);
}

module.exports = {
  isValidOriginUrl,
  normalizeOrigin,
  resolveAllowedOrigins,
  createCorsMiddleware,
  createHelmetMiddleware,
  validateSecurityConfig,
};
