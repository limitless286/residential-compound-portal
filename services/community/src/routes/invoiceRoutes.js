import { Router } from 'express';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';
import { readInvoice, readInvoices } from '../controllers/invoiceController.js';

const router = Router();

// Ownership is enforced in invoiceQueryService using the session's unitId.
router.use(requireAuthentication, requireRole('ADMIN', 'RESIDENT'));

router.get('/', readInvoices);
router.get('/:id', readInvoice);

export default router;
