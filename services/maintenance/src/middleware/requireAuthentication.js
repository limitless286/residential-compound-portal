import { authenticateToken } from '../services/sessionService.js';

export async function requireAuthentication(req, res, next) {
  const authorization = req.get('Authorization') || '';
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization);

  if (!match) {
    throw Object.assign(new Error('A valid session is required.'), {
      status: 401,
      code: 'UNAUTHORIZED'
    });
  }

  req.auth = await authenticateToken(match[1]);
  next();
}
