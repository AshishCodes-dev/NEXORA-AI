const { validateSafeUrl, isPrivateIp } = require('../research/urlValidator');

/**
 * Browser Execution Security & Operational Policy
 * 
 * Strict constraints governing browser automation, SSRF prevention,
 * redirect revalidation, timeouts, and resource extraction limits.
 */

const BROWSER_POLICY = Object.freeze({
  // Timeouts
  NAVIGATION_TIMEOUT_MS: 30000,    // 30s max per navigation
  TOTAL_TIMEOUT_MS: 60000,         // 60s max per overall browser task

  // Concurrency & Resources
  MAX_CONCURRENT_JOBS: 2,          // Strict cap: max 2 active browser runs

  // Content Extraction Limits
  MAX_TEXT_LENGTH: 20000,          // 20,000 characters body text bound
  MAX_HEADINGS: 50,                // 50 headings max
  MAX_LINKS: 100,                  // 100 extracted links max
  MAX_ITEM_TEXT_LENGTH: 1000,      // Max 1,000 chars per heading / link text
  MAX_REDIRECTS: 10,               // Max chain length for redirects

  // Viewport & Environment
  VIEWPORT: Object.freeze({
    width: 1280,
    height: 800,
  }),
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 NEXORA-Agent/1.0',
});

/**
 * Rapid synchronous check for dangerous URL schemes and local identifiers
 * before initiating DNS resolution or Chromium launch.
 * 
 * @param {string} rawUrl
 * @returns {{ isAllowed: boolean, reason?: string, parsedUrl?: URL }}
 */
function checkUrlSynchronous(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isAllowed: false, reason: 'URL must be a non-empty string' };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { isAllowed: false, reason: 'URL cannot be empty' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { isAllowed: false, reason: 'INVALID_URL_SYNTAX' };
  }

  // Strictly permit http and https protocols only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isAllowed: false, reason: `UNSAFE_PROTOCOL: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { isAllowed: false, reason: 'EMPTY_HOSTNAME' };
  }

  // Reject localhost, local, internal, test domains
  const blockedHostnames = [
    'localhost',
    'metadata.google.internal',
    'instance-data',
    'metadata.turing.com',
    'api.internal',
  ];

  if (
    blockedHostnames.includes(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.invalid')
  ) {
    return { isAllowed: false, reason: `BLOCKED_HOSTNAME: ${hostname}` };
  }

  return { isAllowed: true, parsedUrl: parsed };
}

/**
 * Validates a target URL against SSRF vulnerabilities, DNS rebinding,
 * private/reserved IP allocations, and dangerous protocols.
 * 
 * @param {string} rawUrl - Target URL to validate
 * @returns {Promise<{ isValid: boolean, url?: string, reason?: string, resolvedIps?: string[] }>}
 */
async function validateBrowserUrl(rawUrl) {
  // 1. Synchronous check first
  const syncCheck = checkUrlSynchronous(rawUrl);
  if (!syncCheck.isAllowed) {
    return { isValid: false, reason: syncCheck.reason };
  }

  // 2. Perform deep DNS-resolved validation via research urlValidator
  return await validateSafeUrl(rawUrl);
}

module.exports = {
  BROWSER_POLICY,
  checkUrlSynchronous,
  validateBrowserUrl,
  isPrivateIp,
};
