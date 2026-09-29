const { validateSafeUrl } = require('./urlValidator');
const { extractReadableContent } = require('./htmlExtractor');

/**
 * Fetches and extracts readable content from a remote URL.
 * Enforces strict SSRF protections, redirect limits, timeouts,
 * MIME type checks, and payload size bounds.
 * 
 * @param {string} targetUrl - The URL to fetch
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=8000] - Request timeout in milliseconds
 * @param {number} [options.maxRedirects=3] - Maximum allowable redirects
 * @param {number} [options.maxSizeBytes=524288] - Maximum response size in bytes (512 KB)
 * @returns {Promise<{ url: string, title: string, text: string, retrievedAt: string }>}
 */
async function fetchSource(targetUrl, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  const maxRedirects = options.maxRedirects !== undefined ? options.maxRedirects : 3;
  const maxSizeBytes = options.maxSizeBytes || 512 * 1024; // 512 KB

  let currentUrl = targetUrl;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // 1. SSRF URL and IP validation
    const validation = await validateSafeUrl(currentUrl);
    if (!validation.isValid) {
      throw new Error(`SSRF_PROTECTION_BLOCKED: URL '${currentUrl}' was rejected: ${validation.reason}`);
    }

    // 2. Controlled request with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual', // Enforce manual redirect handling to re-validate destination
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NexoraResearchBot/1.0',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        throw new Error(`SOURCE_FETCH_TIMEOUT: Request to '${currentUrl}' timed out after ${timeoutMs}ms`);
      }
      throw new Error(`SOURCE_FETCH_FAILED: Failed to fetch '${currentUrl}': ${fetchErr.message}`);
    } finally {
      clearTimeout(timer);
    }

    // 3. Handle HTTP redirects
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`SOURCE_FETCH_FAILED: Redirect response from '${currentUrl}' missing Location header`);
      }

      currentUrl = new URL(location, currentUrl).href;
      redirectCount++;
      continue;
    }

    // 4. Validate HTTP status
    if (!res.ok) {
      throw new Error(`SOURCE_FETCH_ERROR: HTTP ${res.status} (${res.statusText}) for '${currentUrl}'`);
    }

    // 5. Content-Type check
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isValidType =
      contentType.includes('text/html') ||
      contentType.includes('text/plain') ||
      contentType.includes('application/xhtml+xml');

    if (!isValidType) {
      throw new Error(`SOURCE_FETCH_INVALID_CONTENT_TYPE: Unsupported Content-Type '${contentType}' for '${currentUrl}'`);
    }

    // 6. Response size check & body reading
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes * 2) {
      throw new Error(`SOURCE_FETCH_PAYLOAD_TOO_LARGE: Content-Length ${contentLength} exceeds limit of ${maxSizeBytes} bytes`);
    }

    const rawBody = await res.text();
    const safeBody = rawBody.length > maxSizeBytes ? rawBody.slice(0, maxSizeBytes) : rawBody;

    // 7. Extract readable text & title
    const extracted = extractReadableContent(safeBody);

    return {
      url: currentUrl,
      title: extracted.title || currentUrl,
      text: extracted.text,
      retrievedAt: new Date().toISOString(),
    };
  }

  throw new Error(`SOURCE_FETCH_REDIRECT_LIMIT: Exceeded maximum redirects (${maxRedirects}) for '${targetUrl}'`);
}

module.exports = {
  fetchSource,
};
