import { isDatabaseUnavailable, retryableDatabaseError } from '../config/database.js';
import { logAction } from '../utils/logger.js';

// Statuses whose code and message were set deliberately by our own code
// and are safe to return to the client.
const EXPOSED_STATUSES = new Set([400, 401, 403, 404, 409, 413, 429, 503]);

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let status;
  let code;
  let message;

  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must contain valid JSON.';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  } else if (
    EXPOSED_STATUSES.has(error.status) &&
    typeof error.code === 'string'
  ) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (retryableDatabaseError(error)) {
    ({ code, message } = retryableDatabaseError(error));
    status = 503;
    res.set('Retry-After', '1');
  } else if (isDatabaseUnavailable(error)) {
    status = 503;
    code = 'DATABASE_UNAVAILABLE';
    message = 'The database is temporarily unavailable.';
  } else {
    status = 500;
    code = 'INTERNAL_ERROR';
    message = 'An unexpected error occurred.';
  }

  logAction({
    requestId: req.requestId,
    action: 'REQUEST',
    outcome: 'FAILED',
    level: status >= 500 ? 'error' : 'warn',
    method: req.method,
    path: req.path,
    status,
    code
  });

  res.status(status).json({
    error: { code, message },
    requestId: req.requestId
  });
}
