import { httpError } from '../utils/httpError.js';
import {
  selectActiveUnits
} from '../repositories/internalIdentityRepository.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(cursor)) {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.');
  }

  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');

  if (!uuidPattern.test(decoded) ||
      Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.');
  }

  return decoded;
}

export async function lookupActiveUnits(user, query) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  if (Object.keys(query).some(
    (field) => !['limit', 'cursor'].includes(field)
  )) {
    throw invalid('Only limit and cursor are accepted.');
  }

  let limit = 100;

  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' ||
        !/^\d{1,3}$/.test(query.limit)) {
      throw invalid('limit must be an integer between 1 and 200.');
    }

    limit = Number(query.limit);

    if (limit < 1 || limit > 200) {
      throw invalid('limit must be between 1 and 200.');
    }
  }

  const afterId = query.cursor === undefined
    ? null
    : decodeCursor(query.cursor);

  const result = await selectActiveUnits({ afterId, limit });

  const lastUnit = result.units.at(-1);

  return {
    units: result.units,
    nextCursor: result.hasMore
      ? Buffer.from(lastUnit.unitId, 'utf8').toString('base64url')
      : null
  };
}
