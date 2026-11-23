import internalIdentityRoutes from './routes/internalIdentityRoutes.js';
import maintenanceAdminRoutes from './routes/maintenanceAdminRoutes.js';
import maintenanceRoutes from './routes/maintenanceRoutes.js';
import internalAuthRoutes from './routes/internalAuthRoutes.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import authRoutes from './routes/authRoutes.js';

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
    data: { service: 'maintenance', status: 'ok' },
    requestId: req.requestId
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', maintenanceAdminRoutes);
app.use('/api/v1/maintenance-requests', maintenanceRoutes);
app.use('/internal/v1/auth', internalAuthRoutes);
app.use('/internal/v1', internalIdentityRoutes);

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

  let status = error.status || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message;

  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must contain valid JSON.';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  } else if (![400, 401, 403, 404, 409, 429, 503].includes(status)) {
    status = 500;
    code = 'INTERNAL_ERROR';
    message = 'An unexpected error occurred.';
  }

  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'maintenance',
    action: req.path === '/api/v1/auth/login' ? 'LOGIN' : 'REQUEST',
    outcome: 'FAILED',
    status,
    code,
    requestId: req.requestId
  }));

  res.status(status).json({
    error: { code, message },
    requestId: req.requestId
  });
});

export default app;




