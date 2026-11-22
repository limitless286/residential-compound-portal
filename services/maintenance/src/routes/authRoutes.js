import protectedAuthRoutes from './protectedAuthRoutes.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { login } from '../controllers/authController.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'LOGIN',
      outcome: 'RATE_LIMITED',
      requestId: req.requestId
    }));

    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Try again later.'
      },
      requestId: req.requestId
    });
  }
});

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.post('/login', loginLimiter, login);

router.use(protectedAuthRoutes);

export default router;

