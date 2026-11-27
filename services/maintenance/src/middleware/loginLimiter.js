import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import { consumeLoginAttempt } from '../repositories/loginLimitRepository.js';

export async function loginLimiter(req, res, next) {
  const clientIp = req.ip;

  if (!clientIp || !isIP(clientIp)) {
    throw Object.assign(new Error('Login protection is unavailable.'), {
      status: 503,
      code: 'LOGIN_PROTECTION_UNAVAILABLE'
    });
  }

  const clientIdentifier = ipKeyGenerator(clientIp, 56);
  const result = await consumeLoginAttempt(clientIdentifier);

  if (result.allowed) {
    return next();
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000)
  );

  res.setHeader('Retry-After', String(retryAfterSeconds));

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'maintenance',
    action: 'LOGIN',
    outcome: 'RATE_LIMITED',
    requestId: req.requestId
  }));

  return res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Try again later.'
    },
    requestId: req.requestId
  });
}
