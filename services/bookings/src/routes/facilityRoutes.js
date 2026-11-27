import express from 'express';

import {
  createFacilityRecord,
  editFacilityRecord,
  listFacilityRecords,
  replaceOpeningHoursRecord
} from '../controllers/facilityController.js';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

router.get(
  '/facilities',
  noStore,
  requireAuthentication,
  requireRole('ADMIN', 'RESIDENT'),
  listFacilityRecords
);

router.post(
  '/admin/facilities',
  noStore,
  requireAuthentication,
  requireRole('ADMIN'),
  createFacilityRecord
);

router.patch(
  '/admin/facilities/:id',
  noStore,
  requireAuthentication,
  requireRole('ADMIN'),
  editFacilityRecord
);

router.put(
  '/admin/facilities/:id/opening-hours',
  noStore,
  requireAuthentication,
  requireRole('ADMIN'),
  replaceOpeningHoursRecord
);

export default router;
