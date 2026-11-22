import { Router } from 'express';
import { requireAuthentication } from '../middleware/requireAuthentication.js';
import { me, logout } from '../controllers/sessionController.js';

const router = Router();

router.get('/me', requireAuthentication, me);
router.post('/logout', requireAuthentication, logout);

export default router;
