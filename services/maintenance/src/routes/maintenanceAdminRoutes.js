import { overdueNotifications } from '../controllers/overdueNotificationsController.js';
import { editUnitRecord } from '../controllers/unitEditController.js';
import { editBuildingRecord } from '../controllers/buildingEditController.js';
import { editResidentRecord } from '../controllers/residentEditController.js';
import { listResidentRecords, changeResidentStatusRecord } from '../controllers/residentManagementController.js';
import { createResidentRecord } from '../controllers/residentController.js';
import { createUnitRecord, listUnitRecords } from '../controllers/unitController.js';
import { createBuildingRecord, listBuildingRecords } from '../controllers/buildingController.js';
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
router.get('/overdue-notifications', overdueNotifications);

router.get('/buildings', listBuildingRecords);
router.post('/buildings', createBuildingRecord);

router.get('/units', listUnitRecords);
router.post('/units', createUnitRecord);

router.post('/residents', createResidentRecord);

router.get('/residents', listResidentRecords);
router.patch('/residents/:id/status', changeResidentStatusRecord);

router.patch('/residents/:id', editResidentRecord);

router.patch('/buildings/:id', editBuildingRecord);

router.patch('/units/:id', editUnitRecord);

export default router;







