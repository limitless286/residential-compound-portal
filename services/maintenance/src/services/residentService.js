import { httpError } from '../utils/httpError.js';
import { hashPassword } from './passwordService.js';
import { insertResident } from '../repositories/residentRepository.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

export async function createResident(user, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Body must be a JSON object.');
  }

  const allowed = new Set(['unitId', 'fullName', 'email', 'password']);

  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) {
      throw invalid(`Unknown field: ${field}.`);
    }
  }

  if (typeof body.unitId !== 'string' ||
      !uuidPattern.test(body.unitId)) {
    throw invalid('unitId must be a valid UUID.');
  }

  if (typeof body.fullName !== 'string') {
    throw invalid('fullName must be a string.');
  }

  const fullName = body.fullName.trim();
  const nameLength = Array.from(fullName).length;

  if (nameLength < 1 || nameLength > 150 ||
      fullName.includes('\u0000')) {
    throw invalid('fullName must contain 1 to 150 valid characters.');
  }

  if (typeof body.email !== 'string') {
    throw invalid('email must be a string.');
  }

  const email = body.email.trim().toLowerCase();

  if (email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.includes('\u0000')) {
    throw invalid('A valid email address is required.');
  }

  if (typeof body.password !== 'string' ||
      body.password.length < 12 ||
      body.password.length > 128) {
    throw invalid('password must contain 12 to 128 characters.');
  }

  // Normal account creation always uses the standard password policy.
  const passwordHash = await hashPassword(body.password);

  try {
    return await insertResident({
      unitId: body.unitId.toLowerCase(),
      fullName,
      email,
      passwordHash
    });
  } catch (error) {
    if (error.code === '23505') {
      throw httpError(
        409,
        'EMAIL_EXISTS',
        'An account with this email already exists.'
      );
    }

    if (error.code === '23503') {
      throw httpError(
        409,
        'UNIT_CHANGED',
        'The selected unit is no longer available.'
      );
    }

    throw error;
  }
}
