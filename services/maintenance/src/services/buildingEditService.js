import { httpError } from '../utils/httpError.js';
import {
  updateBuilding
} from '../repositories/buildingRepository.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

export async function editBuilding(user, buildingId, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  if (typeof buildingId !== 'string' || !uuidPattern.test(buildingId)) {
    throw invalid('Building id must be a valid UUID.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Body must be a JSON object.');
  }

  const fields = Object.keys(body);

  if (fields.length === 0 ||
      fields.some((field) => !['code', 'name'].includes(field))) {
    throw invalid('Provide code or name only.');
  }

  const changes = {};

  if (Object.hasOwn(body, 'code')) {
    if (typeof body.code !== 'string') {
      throw invalid('code must be a string.');
    }

    const code = body.code.trim().toUpperCase();

    if (!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code)) {
      throw invalid(
        'code must contain 1 to 30 letters, numbers, hyphens or underscores, starting with a letter or number.'
      );
    }

    changes.code = code;
  }

  if (Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string') {
      throw invalid('name must be a string.');
    }

    const name = body.name.trim();
    const length = Array.from(name).length;

    if (length < 1 || length > 100 || name.includes('\u0000')) {
      throw invalid('name must contain 1 to 100 valid characters.');
    }

    changes.name = name;
  }

  try {
    const building = await updateBuilding({
      id: buildingId.toLowerCase(),
      ...changes
    });

    if (!building) {
      throw httpError(
        404,
        'BUILDING_NOT_FOUND',
        'Building not found.'
      );
    }

    return building;
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
