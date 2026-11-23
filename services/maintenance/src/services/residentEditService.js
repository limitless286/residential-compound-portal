import { httpError } from '../utils/httpError.js';
import {
  updateResidentDetails
} from '../repositories/residentEditRepository.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

export async function editResident(user, residentId, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  if (typeof residentId !== 'string' || !uuidPattern.test(residentId)) {
    throw invalid('Resident id must be a valid UUID.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Body must be a JSON object.');
  }

  const fields = Object.keys(body);

  if (fields.length === 0 ||
      fields.some((field) => !['fullName', 'email', 'unitId'].includes(field))) {
    throw invalid('Provide fullName, email or unitId only.');
  }

  const changes = {};

  if (Object.hasOwn(body, 'fullName')) {
    if (typeof body.fullName !== 'string') {
      throw invalid('fullName must be a string.');
    }

    const fullName = body.fullName.trim();
    const length = Array.from(fullName).length;

    if (length < 1 || length > 150 || fullName.includes('\u0000')) {
      throw invalid('fullName must contain 1 to 150 valid characters.');
    }

    changes.fullName = fullName;
  }

  if (Object.hasOwn(body, 'email')) {
    if (typeof body.email !== 'string') {
      throw invalid('email must be a string.');
    }

    const email = body.email.trim().toLowerCase();

    if (email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.includes('\u0000')) {
      throw invalid('A valid email address is required.');
    }

    changes.email = email;
  }

  if (Object.hasOwn(body, 'unitId')) {
    if (typeof body.unitId !== 'string' || !uuidPattern.test(body.unitId)) {
      throw invalid('unitId must be a valid UUID.');
    }

    changes.unitId = body.unitId.toLowerCase();
  }

  try {
    return await updateResidentDetails({
      id: residentId.toLowerCase(),
      ...changes
    });
  } catch (error) {
    if (error.code === '23505') {
      throw httpError(
        409,
        'EMAIL_EXISTS',
        'An account with this email already exists.'
      );
    }

    throw error;
  }
}
