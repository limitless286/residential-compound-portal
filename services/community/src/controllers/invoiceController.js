import { generateInvoices } from '../services/invoiceGenerationService.js';
import { getInvoice, listInvoices } from '../services/invoiceQueryService.js';
import { requireIdempotencyKey } from '../utils/validation.js';

export async function createInvoiceGeneration(req, res) {
  const idempotencyKey = requireIdempotencyKey(req);

  const result = await generateInvoices({
    user: req.auth.user,
    // Forwarded to identity for this request only; never stored.
    authorization: req.get('Authorization'),
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

export async function readInvoices(req, res) {
  const data = await listInvoices({ user: req.auth.user, query: req.query });
  res.status(200).json({ data, requestId: req.requestId });
}

export async function readInvoice(req, res) {
  const data = await getInvoice({
    user: req.auth.user,
    invoiceId: req.params.id
  });

  res.status(200).json({ data, requestId: req.requestId });
}
