/**
 * Browser Result Normalization & Error Taxonomy
 * 
 * Ensures all browser execution outcomes (successes and controlled failures)
 * adhere to a deterministic contract with zero synthesized/fake data,
 * normalized error codes, and strict secret/stack-trace redaction.
 */

const BROWSER_ERROR_CODES = Object.freeze({
  INVALID_URL: 'INVALID_URL',
  BLOCKED_URL: 'BLOCKED_URL',
  REDIRECT_BLOCKED: 'REDIRECT_BLOCKED',
  NAVIGATION_TIMEOUT: 'NAVIGATION_TIMEOUT',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  BROWSER_LAUNCH_FAILED: 'BROWSER_LAUNCH_FAILED',
  PAGE_READ_FAILED: 'PAGE_READ_FAILED',
  PAGE_EXTRACTION_FAILED: 'PAGE_EXTRACTION_FAILED',
  BROWSER_CAPACITY_EXCEEDED: 'BROWSER_CAPACITY_EXCEEDED',
  BROWSER_TARGET_MISSING: 'BROWSER_TARGET_MISSING',
  EVIDENCE_PERSISTENCE_FAILED: 'EVIDENCE_PERSISTENCE_FAILED',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
});

/**
 * Strips sensitive environment variables, internal file paths,
 * authentication tokens, and stack traces from error messages.
 * 
 * @param {string} rawMessage
 * @returns {string} Clean, safe error message
 */
function sanitizeErrorMessage(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return 'An unknown browser execution error occurred.';
  }

  return rawMessage
    // Strip Windows/Unix file system paths
    .replace(/[A-Za-z]:\\[^:\s"'<>]+/g, '[redacted_path]')
    .replace(/\/[^:\s"'<>]+\/[^:\s"'<>]+/g, '[redacted_path]')
    // Strip possible API keys / JWTs / bearer tokens
    .replace(/bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [redacted]')
    .replace(/AIza[0-9A-Za-z-_]{20,}/g, '[redacted_gemini_key]')
    // Truncate to reasonable bounds
    .slice(0, 300)
    .trim();
}

/**
 * Constructs a normalized browser execution success result.
 * 
 * @param {object} params
 * @param {string} params.taskId
 * @param {'navigate'|'read'|'extract'} params.operation
 * @param {string} params.url
 * @param {string} params.finalUrl
 * @param {string} params.title
 * @param {number|null} params.httpStatus
 * @param {object} [params.payload]
 * @param {number} params.timingMs
 * @returns {object} Standardized agent outcome
 */
function createBrowserSuccessResult({
  taskId,
  operation,
  url,
  finalUrl,
  title,
  httpStatus = 200,
  payload = {},
  timingMs = 0,
}) {
  let message = `Browser operation '${operation}' succeeded for URL: ${url}`;
  if (operation === 'read') {
    message = `Browser read complete: captured ${payload.textLength || 0} characters from '${title || url}'.`;
  } else if (operation === 'extract') {
    message = `Browser extraction complete: retrieved ${payload.headings?.length || 0} headings and ${payload.links?.length || 0} links from '${title || url}'.`;
  }

  return {
    status: 'completed',
    agentId: 'browser',
    taskId: taskId || 'unknown',
    message,
    data: {
      operation,
      url,
      finalUrl: finalUrl || url,
      title: title || '',
      httpStatus: typeof httpStatus === 'number' ? httpStatus : null,
      timingMs: Math.max(0, Math.round(timingMs)),
      ...payload,
      error: null,
    },
  };
}

/**
 * Constructs a normalized browser execution failure result.
 * Strict: Never returns fake or synthetic page content on failure.
 * 
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.operation
 * @param {string} params.errorCode - Member of BROWSER_ERROR_CODES
 * @param {string} params.errorMessage
 * @param {string} [params.url]
 * @param {number} [params.timingMs]
 * @returns {object} Standardized agent outcome
 */
function createBrowserFailureResult({
  taskId,
  operation = 'unknown',
  errorCode,
  errorMessage,
  url = '',
  timingMs = 0,
}) {
  const code = BROWSER_ERROR_CODES[errorCode] || 'BROWSER_EXECUTION_FAILED';
  const cleanMsg = sanitizeErrorMessage(errorMessage);

  return {
    status: 'failed',
    agentId: 'browser',
    taskId: taskId || 'unknown',
    message: `Browser operation '${operation}' failed [${code}]: ${cleanMsg}`,
    data: {
      operation,
      url: url || '',
      finalUrl: null,
      title: null,
      httpStatus: null,
      timingMs: Math.max(0, Math.round(timingMs)),
      error: {
        code,
        message: cleanMsg,
      },
    },
  };
}

module.exports = {
  BROWSER_ERROR_CODES,
  sanitizeErrorMessage,
  createBrowserSuccessResult,
  createBrowserFailureResult,
};
