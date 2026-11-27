import express from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuthentication } from './middleware/requireAuthentication.js';
import { errorHandler } from './middleware/errorHandler.js';
import adminRoutes from './routes/adminRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import announcementRoutes from './routes/announcementRoutes.js';
import internalRoutes from './routes/internalRoutes.js';

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

app.use(errorHandler);

export default app;
