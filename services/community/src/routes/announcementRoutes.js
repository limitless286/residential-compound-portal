import { Router } from 'express';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  readAnnouncement,
  readAnnouncements,
  recordAnnouncementRead
} from '../controllers/announcementController.js';

const router = Router();

router.use(requireAuthentication);

// Audience and publication-window rules are applied in the service.
router.get('/', requireRole('ADMIN', 'RESIDENT'), readAnnouncements);
router.get('/:id', requireRole('ADMIN', 'RESIDENT'), readAnnouncement);
router.post('/:id/read', requireRole('RESIDENT'), recordAnnouncementRead);

export default router;
