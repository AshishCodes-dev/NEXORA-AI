/**
 * Centralized API Base URL Resolver for NEXORA AI Frontend.
 *
 * Supports two production deployment architectures:
 * 1. Direct Cross-Origin:
 *    - VITE_API_URL set to e.g. "https://api.nexora.ai"
 *    - Requests are sent directly to the backend origin.
 *
 * 2. First-Party Same-Origin Reverse Proxy (Recommended for Vercel/Cloudflare):
 *    - VITE_API_URL set to "" or "/" (or empty string in deployment env)
 *    - Requests are sent as same-origin "/api/..."
 *    - Hosting rewrite (e.g. vercel.json) proxies "/api/*" to the backend.
 *    - Eliminates cross-site cookie restrictions and third-party cookie drops.
 *
 * Local Standalone Development Default:
 * - If VITE_API_URL is undefined, falls back to "http://localhost:5000".
 *
 * @param {object} [env=import.meta.env]
 * @returns {string} Normalized base URL
 */
export function resolveApiBaseUrl(env) {
  const activeEnv = env || (typeof import.meta !== 'undefined' ? import.meta.env : undefined);
  if (activeEnv && typeof activeEnv.VITE_API_URL === 'string') {
    let trimmed = activeEnv.VITE_API_URL.trim();
    if (trimmed === '' || trimmed === '/') {
      return '';
    }
    trimmed = trimmed.replace(/\/+$/, '');
    // Prevent duplicated /api prefixes if environment variable includes /api
    if (trimmed.toLowerCase().endsWith('/api')) {
      trimmed = trimmed.slice(0, -4).replace(/\/+$/, '');
    }
    return trimmed;
  }
  return 'http://localhost:5000';
}

export const API_BASE_URL = resolveApiBaseUrl();

const TOKEN_STORAGE_KEY = 'nexora_auth_token';

/**
 * Retrieve persisted session token from storage (for cross-origin environments)
 * @returns {string|null}
 */
export function getStoredToken() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(TOKEN_STORAGE_KEY) || null;
    }
  } catch {
    // Restricted environment fallback
  }
  return null;
}

/**
 * Store or remove session token in storage
 * @param {string|null} token
 */
export function setStoredToken(token) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (token && typeof token === 'string' && token.trim()) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // Restricted environment fallback
  }
}

/**
 * Merges Authorization Bearer token header if token is present
 * @param {object} [customHeaders={}]
 * @returns {object}
 */
export function getAuthHeaders(customHeaders = {}) {
  const token = getStoredToken();
  const headers = { ...customHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}
