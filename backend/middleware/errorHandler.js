/**
 * Centralized Error & 404 Handling Middleware
 * 
 * Guarantees that unhandled route errors return safe, structured JSON responses
 * and suppresses internal stack traces in production environments.
 */

/**
 * Fallback 404 handler for undefined API routes
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: `Cannot ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
  });
}

/**
 * Central Express error handler
 * 
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function centralErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.status || err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
  const isProduction = process.env.NODE_ENV === 'production';

  // Diagnostic logging (sanitizes accidental secret leakage from message)
  const safeMessage = (err.message || 'Unknown internal error')
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
    .replace(/(password\s*[:=]\s*)[^\s&]+/gi, '$1[REDACTED]')
    .replace(/(secret\s*[:=]\s*)[^\s&]+/gi, '$1[REDACTED]');

  if (statusCode >= 500) {
    console.error(`[SERVER ERROR] ${req.method} ${req.originalUrl} (${statusCode}):`, safeMessage);
    if (!isProduction && err.stack) {
      console.error(err.stack);
    }
  }

  const clientError = isProduction && statusCode === 500
    ? 'An unexpected internal server error occurred.'
    : safeMessage;

  return res.status(statusCode).json({
    success: false,
    error: clientError,
    code: err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
    ...(!isProduction && err.stack ? { stack: err.stack } : {}),
  });
}

module.exports = {
  notFoundHandler,
  centralErrorHandler,
};
