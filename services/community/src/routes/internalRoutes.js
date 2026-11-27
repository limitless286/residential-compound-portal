import { Router } from 'express';
import {
  allowCaller,
  requireInternalService
} from '../middleware/requireInternalService.js';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';
import { createInternalDraft } from '../controllers/announcementController.js';

const router = Router();

// Contract order: authenticate the calling service, check it may use the
// endpoint, authenticate the initiating user, enforce the role, validate.
router.post(
  '/announcements/drafts',
  requireInternalService,
  allowCaller('maintenance'),
  requireAuthentication,
  requireRole('ADMIN'),
  createInternalDraft
);

export default router;
