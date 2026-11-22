import { createHash, timingSafeEqual } from 'node:crypto';

const serviceKeys = {
  bookings: process.env.BOOKINGS_AUTH_KEY,
  community: process.env.COMMUNITY_AUTH_KEY
};

for (const [service, key] of Object.entries(serviceKeys)) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) {
    throw new Error('Missing or invalid internal key for ' + service);
  }
}

function reject(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

export function requireInternalService(req, res, next) {
  const serviceName = req.get('X-Service-Name');
  const providedKey = req.get('X-Service-Key');

  if (!serviceName || !providedKey) {
    reject(401, 'SERVICE_AUTH_REQUIRED', 'Service authentication is required.');
  }

  if (
    !Object.hasOwn(serviceKeys, serviceName) ||
    !/^[a-f0-9]{64}$/.test(providedKey)
  ) {
    reject(403, 'SERVICE_FORBIDDEN', 'Service access denied.');
  }

  const expectedHash = createHash('sha256')
    .update(serviceKeys[serviceName])
    .digest();

  const providedHash = createHash('sha256')
    .update(providedKey)
    .digest();

  if (!timingSafeEqual(expectedHash, providedHash)) {
    reject(403, 'SERVICE_FORBIDDEN', 'Service access denied.');
  }

  req.callingService = serviceName;
  next();
}
