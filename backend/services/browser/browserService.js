const { chromium } = require('playwright');
const {
  BROWSER_POLICY,
  validateBrowserUrl,
} = require('./browserPolicy');
const {
  BROWSER_ERROR_CODES,
  createBrowserSuccessResult,
  createBrowserFailureResult,
} = require('./browserResult');

/**
 * Real Playwright Browser Execution Service
 * 
 * Implements local headless Chromium execution for:
 * - navigate: verifies target reachability, status, and title
 * - read: extracts clean bounded page text
 * - extract: retrieves structured headings, links, and page metadata
 * 
 * Enforces strict SSRF safeguards, redirect revalidation, concurrency limits (max 2),
 * timeouts, and guaranteed process cleanup in finally blocks.
 */

let activeJobs = 0;

/**
 * Returns current concurrency telemetry.
 * 
 * @returns {{ activeJobs: number, maxJobs: number }}
 */
function getConcurrencyStatus() {
  return {
    activeJobs,
    maxJobs: BROWSER_POLICY.MAX_CONCURRENT_JOBS,
  };
}

/**
 * Executes a single controlled browser operation.
 * 
 * @param {object} params
 * @param {string} params.taskId - Mission task identifier
 * @param {'navigate'|'read'|'extract'} [params.operation='extract'] - Target browser operation
 * @param {string} params.url - Target URL to inspect
 * @param {object} [params.options={}] - Optional tuning parameters
 * @returns {Promise<object>} Standardized agent outcome
 */
async function executeBrowserOperation({
  taskId = 'browser-task',
  operation = 'extract',
  url,
  options = {},
}) {
  const startTime = Date.now();
  const normalizedOp = (operation || 'extract').trim().toLowerCase();

  // 1. Verify operation validity
  if (!['navigate', 'read', 'extract'].includes(normalizedOp)) {
    return createBrowserFailureResult({
      taskId,
      operation: normalizedOp,
      errorCode: 'UNSUPPORTED_OPERATION',
      errorMessage: `Operation '${operation}' is not supported. Permitted operations: navigate, read, extract.`,
      url,
      timingMs: Date.now() - startTime,
    });
  }

  // 2. Concurrency guard: reject if capacity is full
  if (activeJobs >= BROWSER_POLICY.MAX_CONCURRENT_JOBS) {
    return createBrowserFailureResult({
      taskId,
      operation: normalizedOp,
      errorCode: 'BROWSER_CAPACITY_EXCEEDED',
      errorMessage: `Maximum concurrent browser jobs (${BROWSER_POLICY.MAX_CONCURRENT_JOBS}) exceeded. Capacity unavailable.`,
      url,
      timingMs: Date.now() - startTime,
    });
  }

  // 3. Pre-flight URL security and SSRF validation
  if (!url || typeof rawUrlString(url)) {
    // Check type safety
  }

  if (!url || typeof url !== 'string') {
    return createBrowserFailureResult({
      taskId,
      operation: normalizedOp,
      errorCode: 'INVALID_URL',
      errorMessage: 'Missing or non-string URL provided for browser execution.',
      url: '',
      timingMs: Date.now() - startTime,
    });
  }

  const urlValidation = await validateBrowserUrl(url);
  if (!urlValidation.isValid) {
    const isInvalidSyntax = urlValidation.reason === 'INVALID_URL_SYNTAX' || urlValidation.reason?.includes('UNSAFE_PROTOCOL');
    return createBrowserFailureResult({
      taskId,
      operation: normalizedOp,
      errorCode: isInvalidSyntax ? 'INVALID_URL' : 'BLOCKED_URL',
      errorMessage: `URL failed security policy: ${urlValidation.reason}`,
      url,
      timingMs: Date.now() - startTime,
    });
  }

  // Increment active jobs count
  activeJobs++;

  let browser = null;
  let context = null;
  let page = null;
  let redirectBlocked = false;
  let redirectBlockedReason = '';

  const navTimeout = options.navigationTimeoutMs || BROWSER_POLICY.NAVIGATION_TIMEOUT_MS;
  const totalTimeout = options.totalTimeoutMs || BROWSER_POLICY.TOTAL_TIMEOUT_MS;

  // Wrap inside total operation timeout guard
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(`Total browser execution exceeded ${totalTimeout}ms timeout.`);
      err.code = 'TOTAL_TIMEOUT';
      reject(err);
    }, totalTimeout);
  });

  try {
    const executionPromise = (async () => {
      // 4. Launch isolated Chromium instance
      try {
        browser = await chromium.launch({
          headless: true,
        });
      } catch (launchErr) {
        const error = new Error(`Failed to launch Chromium browser: ${launchErr.message}`);
        error.code = 'BROWSER_LAUNCH_FAILED';
        throw error;
      }

      // 5. Create fresh isolated BrowserContext (no shared cookies, cache, or storage)
      context = await browser.newContext({
        viewport: BROWSER_POLICY.VIEWPORT,
        userAgent: BROWSER_POLICY.USER_AGENT,
        ignoreHTTPSErrors: false,
      });

      // 6. Create Page
      page = await context.newPage();
      page.setDefaultNavigationTimeout(navTimeout);

      // Optional test hook for route interception
      if (typeof options.routeInterceptor === 'function') {
        await options.routeInterceptor(page);
      }

      // 7. Route Interception for SSRF Redirect Protection
      await page.route('**/*', async (route) => {
        const request = route.request();
        const reqUrl = request.url();

        // Simulated redirect test hook
        if (options.simulateRedirect && reqUrl.includes('test-redirect')) {
          const loc = options.simulateRedirect.location;
          const locCheck = await validateBrowserUrl(loc);
          if (!locCheck.isValid) {
            redirectBlocked = true;
            redirectBlockedReason = `Redirect to blocked destination: ${loc} (${locCheck.reason})`;
            return route.abort('blockedbyclient');
          }
        }

        if (request.isNavigationRequest()) {
          const check = await validateBrowserUrl(reqUrl);
          if (!check.isValid) {
            redirectBlocked = true;
            redirectBlockedReason = `Redirect/Navigation to blocked destination: ${reqUrl} (${check.reason})`;
            return route.abort('blockedbyclient');
          }
        }
        return route.continue();
      });

      // 7b. Intercept HTTP 3xx responses to detect and revalidate Location headers
      page.on('response', async (res) => {
        const status = res.status();
        if ([301, 302, 303, 307, 308].includes(status)) {
          const loc = res.headers()['location'];
          if (loc) {
            let target;
            try { target = new URL(loc, res.url()).href; } catch (_) { target = loc; }
            const check = await validateBrowserUrl(target);
            if (!check.isValid) {
              redirectBlocked = true;
              redirectBlockedReason = `Server 3xx redirect to blocked destination: ${target} (${check.reason})`;
            }
          }
        }
      });

      // 8. Execute Navigation
      let response = null;
      try {
        response = await page.goto(url, {
          timeout: navTimeout,
          waitUntil: 'domcontentloaded',
        });
      } catch (navErr) {
        if (redirectBlocked) {
          const err = new Error(redirectBlockedReason || 'Redirect to blocked destination was intercepted.');
          err.code = 'REDIRECT_BLOCKED';
          throw err;
        }

        const isTimeout = navErr.name === 'TimeoutError' || navErr.message?.includes('Timeout');
        const err = new Error(navErr.message);
        err.code = isTimeout ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED';
        throw err;
      }

      // 9. Revalidate Final Landed URL
      const finalUrl = page.url();
      const finalCheck = await validateBrowserUrl(finalUrl);
      if (!finalCheck.isValid) {
        const err = new Error(`Landed on forbidden destination: ${finalUrl} (${finalCheck.reason})`);
        err.code = 'REDIRECT_BLOCKED';
        throw err;
      }

      const httpStatus = response ? response.status() : 200;
      const title = (await page.title()) || '';

      // 10. Perform Selected Operation
      if (normalizedOp === 'navigate') {
        return createBrowserSuccessResult({
          taskId,
          operation: 'navigate',
          url,
          finalUrl,
          title,
          httpStatus,
          payload: {},
          timingMs: Date.now() - startTime,
        });
      }

      if (normalizedOp === 'read') {
        let rawText = '';
        try {
          rawText = await page.evaluate(() => {
            if (!document.body) return '';
            const clone = document.body.cloneNode(true);
            const unwanted = clone.querySelectorAll('script, style, noscript, svg, link, iframe');
            unwanted.forEach(el => el.remove());
            return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
          });
        } catch (evalErr) {
          const err = new Error(`Failed to read page text: ${evalErr.message}`);
          err.code = 'PAGE_READ_FAILED';
          throw err;
        }

        const isTruncated = rawText.length > BROWSER_POLICY.MAX_TEXT_LENGTH;
        const text = isTruncated ? rawText.slice(0, BROWSER_POLICY.MAX_TEXT_LENGTH) : rawText;

        return createBrowserSuccessResult({
          taskId,
          operation: 'read',
          url,
          finalUrl,
          title,
          httpStatus,
          payload: {
            text,
            textLength: text.length,
            truncated: isTruncated,
          },
          timingMs: Date.now() - startTime,
        });
      }

      if (normalizedOp === 'extract') {
        let extractedData = null;
        try {
          extractedData = await page.evaluate(({ maxHeadings, maxLinks, maxItemLength, maxTextLength }) => {
            const docTitle = document.title || '';
            const descMeta = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
            const description = descMeta ? (descMeta.getAttribute('content') || '').slice(0, maxItemLength) : '';

            // Headings H1 - H6
            const headingEls = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).slice(0, maxHeadings);
            const headings = headingEls.map(el => ({
              level: parseInt(el.tagName.substring(1), 10) || 1,
              text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, maxItemLength),
            })).filter(h => h.text.length > 0);

            // Links
            const linkEls = Array.from(document.querySelectorAll('a[href]')).slice(0, maxLinks * 3);
            const links = [];
            const seenUrls = new Set();

            for (const a of linkEls) {
              if (links.length >= maxLinks) break;
              const href = a.getAttribute('href');
              if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
              try {
                const resolved = new URL(href, document.baseURI).href;
                if (seenUrls.has(resolved)) continue;
                seenUrls.add(resolved);

                const linkText = (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, maxItemLength);
                links.push({
                  text: linkText || resolved,
                  url: resolved,
                });
              } catch (_) {}
            }

            // Body text
            let bodyText = '';
            if (document.body) {
              const clone = document.body.cloneNode(true);
              const junk = clone.querySelectorAll('script, style, noscript, svg, link, iframe');
              junk.forEach(el => el.remove());
              bodyText = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
            }

            return {
              title: docTitle,
              description,
              headings,
              links,
              text: bodyText.slice(0, maxTextLength),
              isTextTruncated: bodyText.length > maxTextLength,
            };
          }, {
            maxHeadings: BROWSER_POLICY.MAX_HEADINGS,
            maxLinks: BROWSER_POLICY.MAX_LINKS,
            maxItemLength: BROWSER_POLICY.MAX_ITEM_TEXT_LENGTH,
            maxTextLength: BROWSER_POLICY.MAX_TEXT_LENGTH,
          });
        } catch (extractErr) {
          const err = new Error(`Failed to extract page metadata: ${extractErr.message}`);
          err.code = 'PAGE_EXTRACTION_FAILED';
          throw err;
        }

        return createBrowserSuccessResult({
          taskId,
          operation: 'extract',
          url,
          finalUrl,
          title: extractedData.title || title,
          httpStatus,
          payload: {
            description: extractedData.description,
            headings: extractedData.headings,
            links: extractedData.links,
            text: extractedData.text,
            truncated: extractedData.isTextTruncated,
          },
          timingMs: Date.now() - startTime,
        });
      }
    })();

    return await Promise.race([executionPromise, timeoutPromise]);
  } catch (err) {
    const code = err.code || (err.name === 'TimeoutError' ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED');
    return createBrowserFailureResult({
      taskId,
      operation: normalizedOp,
      errorCode: code,
      errorMessage: err.message,
      url,
      timingMs: Date.now() - startTime,
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    // Deterministic resource teardown: Page -> Context -> Browser
    try {
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
    } catch (_) {}

    try {
      if (context) {
        await context.close().catch(() => {});
      }
    } catch (_) {}

    try {
      if (browser) {
        await browser.close().catch(() => {});
      }
    } catch (_) {}

    // Concurrency decrement
    activeJobs = Math.max(0, activeJobs - 1);
  }
}

/**
 * Creates isolated BrowserContexts for isolation testing.
 * 
 * @returns {Promise<{ browser: object, contextA: object, contextB: object }>}
 */
async function createIsolatedContextsForTest() {
  const browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext({ viewport: BROWSER_POLICY.VIEWPORT });
  const contextB = await browser.newContext({ viewport: BROWSER_POLICY.VIEWPORT });
  return { browser, contextA, contextB };
}

function rawUrlString(val) {
  return typeof val === 'string';
}

module.exports = {
  executeBrowserOperation,
  getConcurrencyStatus,
  createIsolatedContextsForTest,
};
