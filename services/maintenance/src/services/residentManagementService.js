import { httpError } from '../utils/httpError.js';
import {
  selectResidents,
  updateResidentStatus
} from '../repositories/residentRepository.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAdmin(user) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }
}

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

function readInteger(value, fallback, minimum, maximum, field) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalid(`${field} must be an integer.`);
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) ||
      number < minimum || number > maximum) {
    throw invalid(`${field} must be between ${minimum} and ${maximum}.`);
  }

  return number;
}

export async function listResidents(user, query) {
  requireAdmin(user);

  if (Object.keys(query).some(
    (field) => !['status', 'limit', 'offset'].includes(field)
  )) {
    throw invalid('Only status, limit and offset are accepted.');
  }

  if (query.status !== undefined &&
      !['ACTIVE', 'DISABLED'].includes(query.status)) {
    throw invalid('status must be ACTIVE or DISABLED.');
  }

  return selectResidents({
    status: query.status ?? null,
    limit: readInteger(query.limit, 20, 1, 100, 'limit'),
    offset: readInteger(query.offset, 0, 0, 10000, 'offset')
  });
}

export async function changeResidentStatus(user, residentId, body) {
  requireAdmin(user);

  if (typeof residentId !== 'string' || !uuidPattern.test(residentId)) {
    throw invalid('Resident id must be a valid UUID.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Body must be a JSON object.');
  }

  if (Object.keys(body).some((field) => field !== 'status')) {
    throw invalid('Only status is accepted.');
  }

  if (!['ACTIVE', 'DISABLED'].includes(body.status)) {
    throw invalid('status must be ACTIVE or DISABLED.');
  }

  return updateResidentStatus({
    id: residentId.toLowerCase(),
    status: body.status
  });
}
