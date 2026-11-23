import { reopenRequest } from '../controllers/maintenanceReopenController.js';
import { confirmResolution } from '../controllers/maintenanceResidentController.js';
import express from 'express';
import {
  requireAuthentication
} from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';
import { createRequest } from '../controllers/maintenanceController.js';
import {
  listRequests,
  getRequest
} from '../controllers/maintenanceQueryController.js';
import {
  adminMaintenanceAction
} from '../controllers/maintenanceWorkflowController.js';

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.use(requireAuthentication);

router.post('/', requireRole('RESIDENT'), createRequest);

router.get(
  '/',
  requireRole('ADMIN', 'RESIDENT'),
  listRequests
);

router.get(
  '/:id',
  requireRole('ADMIN', 'RESIDENT'),
  getRequest
);

router.patch(
  '/:id/start',
  requireRole('ADMIN'),
  adminMaintenanceAction('start')
);

router.patch(
  '/:id/resolve',
  requireRole('ADMIN'),
  adminMaintenanceAction('resolve')
);

router.patch(
  '/:id/confirm',
  requireRole('RESIDENT'),
  confirmResolution
);

router.patch(
  '/:id/reopen',
  requireRole('RESIDENT'),
  reopenRequest
);

export default router;


