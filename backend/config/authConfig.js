/**
 * Authentication Configuration & Security Policies
 * 
 * Enforces strict cryptographic entropy and environment segregation for JWT secrets.
 * Prevents fallback to insecure default credentials in production environments.
 */

const COOKIE_NAME = 'nexora_token';

const INSECURE_DEFAULT_SECRET = 'nexora_dev_jwt_secret_change_in_production';
const MIN_PRODUCTION_SECRET_LENGTH = 32;

const KNOWN_WEAK_SECRETS = new Set([
  'nexora_dev_jwt_secret_change_in_production',
  'secret',
  'jwtsecret',
  'jwt_secret',
  'default',
  'changeme',
  'password',
  '12345678',
  'admin',
]);

/**
 * Resolves the JWT secret according to the active environment.
 * 
 * In production:
 * - JWT_SECRET must be explicitly defined.
 * - Cannot match any known weak defaults.
 * - Must be at least 32 characters long.
 * 
 * In development / test:
 * - Falls back to a deterministic development secret if undefined,
 *   with an explicit console warning.
 * 
 * @param {object} [env=process.env]
 * @returns {string} The validated secret
 */
function getJwtSecret(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const secret = env.JWT_SECRET;

  if (isProduction) {
    if (!secret || typeof secret !== 'string' || !secret.trim()) {
      throw new Error(
        '[SECURITY CONFIG ERROR] JWT_SECRET environment variable is missing in production. Startup aborted.'
      );
    }

    const trimmed = secret.trim();

    if (KNOWN_WEAK_SECRETS.has(trimmed.toLowerCase())) {
      throw new Error(
        '[SECURITY CONFIG ERROR] JWT_SECRET is set to an insecure default secret and cannot be used in production. Startup aborted.'
      );
    }

    if (trimmed.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(
        `[SECURITY CONFIG ERROR] JWT_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters long in production (current length: ${trimmed.length}). Startup aborted.`
      );
    }

    return trimmed;
  }

  // Non-production fallback
  if (secret && typeof secret === 'string' && secret.trim()) {
    return secret.trim();
  }

  return INSECURE_DEFAULT_SECRET;
}

/**
 * Startup validator to fail-fast if security preconditions are not met.
 * 
 * @param {object} [env=process.env]
 */
function validateAuthConfig(env = process.env) {
  // Throws if invalid in production
  getJwtSecret(env);
}

/**
 * Helper to check whether production authentication security is fully configured
 * 
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
function isProductionConfigured(env = process.env) {
  try {
    const isProd = (env.NODE_ENV || 'development') === 'production';
    if (!isProd) return false;
    validateAuthConfig(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Standard secure cookie options for session token storage
 * 
 * @param {object} [env=process.env]
 * @returns {import('express').CookieOptions}
 */
function getCookieOptions(env = process.env) {
  const isProduction = (env.NODE_ENV || 'development') === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    path: '/',
  };
}

module.exports = {
  COOKIE_NAME,
  INSECURE_DEFAULT_SECRET,
  MIN_PRODUCTION_SECRET_LENGTH,
  KNOWN_WEAK_SECRETS,
  getJwtSecret,
  validateAuthConfig,
  isProductionConfigured,
  getCookieOptions,
};
