import { httpError } from '../utils/httpError.js';
import {
  insertUnit,
  selectUnits
} from '../repositories/unitRepository.js';

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

function readBuildingId(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw invalid('buildingId must be a valid UUID.');
  }

  return value.toLowerCase();
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

export async function createUnit(user, body) {
  requireAdmin(user);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Body must be a JSON object.');
  }

  if (Object.keys(body).some(
    (field) => !['buildingId', 'unitNumber'].includes(field)
  )) {
    throw invalid('Only buildingId and unitNumber are accepted.');
  }

  const buildingId = readBuildingId(body.buildingId);

  if (typeof body.unitNumber !== 'string') {
    throw invalid('unitNumber must be a string.');
  }

  const unitNumber = body.unitNumber.trim();
  const length = Array.from(unitNumber).length;

  if (length < 1 || length > 30 || unitNumber.includes('\u0000')) {
    throw invalid('unitNumber must contain 1 to 30 valid characters.');
  }

  try {
    const unit = await insertUnit({ buildingId, unitNumber });

    if (!unit) {
      throw httpError(
        404,
        'BUILDING_NOT_FOUND',
        'Building not found.'
      );
    }

    return unit;
  } catch (error) {
    if (error.code === '23505') {
      throw httpError(
        409,
        'UNIT_NUMBER_EXISTS',
        'This unit number already exists in the selected building.'
      );
    }

    if (error.code === '23503') {
      throw httpError(
        409,
        'BUILDING_CHANGED',
        'The selected building is no longer available.'
      );
    }

    throw error;
  }
}

export async function listUnits(user, query) {
  requireAdmin(user);

  const allowed = new Set(['buildingId', 'status', 'limit', 'offset']);

  for (const field of Object.keys(query)) {
    if (!allowed.has(field)) {
      throw invalid(`Unknown query parameter: ${field}.`);
    }
  }

  if (query.status !== undefined &&
      !['ACTIVE', 'INACTIVE'].includes(query.status)) {
    throw invalid('status must be ACTIVE or INACTIVE.');
  }

  return selectUnits({
    buildingId: query.buildingId === undefined
      ? null
      : readBuildingId(query.buildingId),
    status: query.status ?? null,
    limit: readInteger(query.limit, 20, 1, 100, 'limit'),
    offset: readInteger(query.offset, 0, 0, 10000, 'offset')
  });
}
