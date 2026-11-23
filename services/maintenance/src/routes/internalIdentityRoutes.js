import { notificationRecipientLookup } from '../controllers/notificationRecipientController.js';
import { Router } from 'express';
import {
  requireInternalService
} from '../middleware/requireInternalService.js';
import {
  requireAuthentication
} from '../middleware/requireAuthentication.js';
import { requireRole } from '../middleware/requireRole.js';
import { httpError } from '../utils/httpError.js';
import {
  activeUnitLookup
} from '../controllers/internalIdentityController.js';

const router = Router();

function allowCaller(serviceName) {
  return (req, res, next) => {
    if (req.callingService !== serviceName) {
      return next(httpError(
        403,
        'SERVICE_FORBIDDEN',
        'This service cannot use this endpoint.'
      ));
    }

    next();
  };
}

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get(
  '/units/active',
  requireInternalService,
  allowCaller('community'),
  requireAuthentication,
  requireRole('ADMIN'),
  activeUnitLookup
);

router.post(
  '/users/notification-recipient',
  requireInternalService,
  allowCaller('bookings'),
  requireAuthentication,
  requireRole('ADMIN', 'RESIDENT'),
  notificationRecipientLookup
);

export default router;

