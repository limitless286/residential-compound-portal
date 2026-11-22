import { Router } from 'express';
import { requireInternalService } from '../middleware/requireInternalService.js';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { introspect } from '../controllers/internalAuthController.js';

const router = Router();

router.post(
  '/introspect',
  requireInternalService,
  requireAuthentication,
  introspect
);

export default router;
