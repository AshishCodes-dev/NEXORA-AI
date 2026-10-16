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
    const trimmed = activeEnv.VITE_API_URL.trim();
    if (trimmed === '' || trimmed === '/') {
      return '';
    }
    return trimmed.replace(/\/+$/, '');
  }
  return 'http://localhost:5000';
}

export const API_BASE_URL = resolveApiBaseUrl();
