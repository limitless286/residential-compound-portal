import express from 'express';

import {
  getBookingPolicyRecord,
  replaceBookingPolicyRecord
} from '../controllers/bookingPolicyController.js';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

router.get(
  '/admin/booking-policies',
  noStore,
  requireAuthentication,
  requireRole('ADMIN'),
  getBookingPolicyRecord
);

router.put(
  '/admin/booking-policies',
  noStore,
  requireAuthentication,
  requireRole('ADMIN'),
  replaceBookingPolicyRecord
);

export default router;
