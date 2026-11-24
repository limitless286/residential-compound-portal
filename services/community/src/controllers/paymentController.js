import { recordPayment } from '../services/paymentService.js';
import { listOverdueInvoices } from '../services/invoiceQueryService.js';
import { requireIdempotencyKey } from '../utils/validation.js';

export async function createPayment(req, res) {
  const idempotencyKey = requireIdempotencyKey(req);

  const result = await recordPayment({
    user: req.auth.user,
    idempotencyKey,
    body: req.body,
    requestId: req.requestId
  });

  if (result.replayed) {
    res.setHeader('Idempotent-Replayed', 'true');
  }

  res.status(result.status).json({
    data: result.data,
    requestId: req.requestId
  });
}

export async function readOverdueInvoices(req, res) {
  const data = await listOverdueInvoices({ query: req.query });
  res.status(200).json({ data, requestId: req.requestId });
}
