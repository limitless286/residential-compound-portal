import express from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuthentication } from './middleware/requireAuthentication.js';
import { isDatabaseUnavailable } from './config/database.js';
import { logAction } from './utils/logger.js';
import adminRoutes from './routes/adminRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import announcementRoutes from './routes/announcementRoutes.js';
import internalRoutes from './routes/internalRoutes.js';

// Statuses whose code and message were set deliberately by our own code
// and are safe to return to the client.
const EXPOSED_STATUSES = new Set([400, 401, 403, 404, 409, 413, 429, 503]);

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.use(express.json({ limit: '16kb' }));

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    data: { service: 'community', status: 'ok' },
    requestId: req.requestId
  });
});

app.get('/api/v1/auth/me', requireAuthentication, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    data: req.auth.user,
    requestId: req.requestId
  });
});

app.use(
  ['/api/v1/admin', '/api/v1/invoices', '/api/v1/announcements', '/internal/v1'],
  (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
);

app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/announcements', announcementRoutes);
app.use('/internal/v1', internalRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
    requestId: req.requestId
  });
});

app.use((error, req, res, next) => {
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
});

export default app;
