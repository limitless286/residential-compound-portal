import { Router } from 'express';
import protectedAuthRoutes from './protectedAuthRoutes.js';
import { login } from '../controllers/authController.js';
import { loginLimiter } from '../middleware/loginLimiter.js';

const router = Router();

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.post('/login', loginLimiter, login);

router.use(protectedAuthRoutes);

export default router;
