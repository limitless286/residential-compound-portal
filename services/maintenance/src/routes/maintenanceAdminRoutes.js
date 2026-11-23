import express from 'express';
import {
  requireAuthentication
} from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  maintenanceOverview
} from '../controllers/maintenanceOverviewController.js';

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.use(requireAuthentication, requireRole('ADMIN'));

router.get('/maintenance-overview', maintenanceOverview);

export default router;
