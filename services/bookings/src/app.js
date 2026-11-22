import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    data: {
      service: 'bookings',
      status: 'ok'
    },
    requestId: req.requestId
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found.'
    },
    requestId: req.requestId
  });
});

export default app;
