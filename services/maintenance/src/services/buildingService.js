import { httpError } from '../utils/httpError.js';
import {
  insertBuilding,
  selectBuildings
} from '../repositories/buildingRepository.js';

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

export async function createBuilding(user, body) {
  requireAdmin(user);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Body must be a JSON object.');
  }

  if (Object.keys(body).some(
    (field) => !['code', 'name'].includes(field)
  )) {
    throw invalid('Only code and name are accepted.');
  }

  if (typeof body.code !== 'string' ||
      typeof body.name !== 'string') {
    throw invalid('code and name must be strings.');
  }

  const code = body.code.trim().toUpperCase();
  const name = body.name.trim();

  if (!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code)) {
    throw invalid(
      'code must contain 1 to 30 letters, numbers, hyphens or underscores, starting with a letter or number.'
    );
  }

  const nameLength = Array.from(name).length;

  if (nameLength < 1 || nameLength > 100 || name.includes('\u0000')) {
    throw invalid('name must contain 1 to 100 valid characters.');
  }

  try {
    return await insertBuilding({ code, name });
  } catch (error) {
    if (error.code === '23505') {
      throw httpError(
        409,
        'BUILDING_CODE_EXISTS',
        'A building with this code already exists.'
      );
    }

    throw error;
  }
}

export async function listBuildings(user, query) {
  requireAdmin(user);

  if (Object.keys(query).some(
    (field) => !['limit', 'offset'].includes(field)
  )) {
    throw invalid('Only limit and offset query parameters are accepted.');
  }

  return selectBuildings({
    limit: readInteger(query.limit, 20, 1, 100, 'limit'),
    offset: readInteger(query.offset, 0, 0, 10000, 'offset')
  });
}
