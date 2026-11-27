import { createHash, timingSafeEqual } from 'node:crypto';
import { httpError } from '../utils/httpError.js';

const KEY_PATTERN = /^[a-f0-9]{64}$/;

// Caller credentials for community's internal endpoints. Each caller has
// its own key; a key used to call identity must never be reused here.
function configuredKeys() {
  return {
    maintenance: process.env.MAINTENANCE_AUTH_KEY
  };
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export function requireInternalService(req, res, next) {
  const serviceName = req.get('X-Service-Name');
  const providedKey = req.get('X-Service-Key');

  if (!serviceName || !providedKey) {
    throw httpError(401, 'SERVICE_AUTH_REQUIRED', 'Service authentication is required.');
  }

  const keys = configuredKeys();

  if (!Object.hasOwn(keys, serviceName) || !KEY_PATTERN.test(providedKey)) {
    throw httpError(403, 'SERVICE_FORBIDDEN', 'Service access denied.');
  }

  const expectedKey = keys[serviceName];

  // Missing or reused configuration fails closed.
  if (!KEY_PATTERN.test(expectedKey || '') ||
      expectedKey === process.env.AUTH_SERVICE_KEY) {
    throw httpError(
      503,
      'SERVICE_AUTH_UNAVAILABLE',
      'Service authentication is not configured.'
    );
  }

  if (!timingSafeEqual(digest(expectedKey), digest(providedKey))) {
    throw httpError(403, 'SERVICE_FORBIDDEN', 'Service access denied.');
  }

  req.callingService = serviceName;
  next();
}

export function allowCaller(...serviceNames) {
  return (req, res, next) => {
    if (!serviceNames.includes(req.callingService)) {
      throw httpError(403, 'SERVICE_FORBIDDEN', 'This service cannot use this endpoint.');
    }

    next();
  };
}
