import { httpError } from '../utils/httpError.js';
import { updateUnit } from '../repositories/unitRepository.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

export async function editUnit(user, unitId, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  if (typeof unitId !== 'string' || !uuidPattern.test(unitId)) {
    throw invalid('Unit id must be a valid UUID.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Body must be a JSON object.');
  }

  const fields = Object.keys(body);

  if (fields.length === 0 ||
      fields.some((field) => !['unitNumber', 'status'].includes(field))) {
    throw invalid('Provide unitNumber or status only.');
  }

  const changes = {};

  if (Object.hasOwn(body, 'unitNumber')) {
    if (typeof body.unitNumber !== 'string') {
      throw invalid('unitNumber must be a string.');
    }

    const unitNumber = body.unitNumber.trim();
    const length = Array.from(unitNumber).length;

    if (length < 1 || length > 30 || unitNumber.includes('\u0000')) {
      throw invalid('unitNumber must contain 1 to 30 valid characters.');
    }

    changes.unitNumber = unitNumber;
  }

  if (Object.hasOwn(body, 'status')) {
    if (!['ACTIVE', 'INACTIVE'].includes(body.status)) {
      throw invalid('status must be ACTIVE or INACTIVE.');
    }

    changes.status = body.status;
  }

  try {
    return await updateUnit({
      id: unitId.toLowerCase(),
      ...changes
    });
  } catch (error) {
    if (error.code === '23505') {
      throw httpError(
        409,
        'UNIT_NUMBER_EXISTS',
        'This unit number already exists in the building.'
      );
    }

    throw error;
  }
}
