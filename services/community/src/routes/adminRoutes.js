import { Router } from 'express';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  readFeePolicy,
  replaceFeePolicy
} from '../controllers/feePolicyController.js';
import { createInvoiceGeneration } from '../controllers/invoiceController.js';
import {
  createPayment,
  readOverdueInvoices
} from '../controllers/paymentController.js';

const router = Router();

// Every admin endpoint requires a valid session and the ADMIN role.
router.use(requireAuthentication, requireRole('ADMIN'));

router.get('/fee-policy', readFeePolicy);
router.put('/fee-policy', replaceFeePolicy);
router.post('/invoice-generations', createInvoiceGeneration);
router.post('/payments', createPayment);
router.get('/overdue-invoices', readOverdueInvoices);

export default router;
