import { database, withTransaction } from '../config/database.js';
import {
  insertFacility,
  selectFacilities,
  selectOpeningHours
} from '../repositories/facilityRepository.js';
import { httpError } from '../utils/httpError.js';
import { logAction } from '../utils/logger.js';
import { readText, rejectUnknownFields, requireJsonObject } from '../utils/validation.js';

function requireActor(actor) {
  if (!actor) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (actor.role !== 'ADMIN' && actor.role !== 'RESIDENT') {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission.');
  }
}

function requireAdmin(actor) {
  requireActor(actor);

  if (actor.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }
}

// Residents see active facilities only; admins see all of them.
export async function listFacilities(actor) {
  requireActor(actor);

  const onlyActive = actor.role !== 'ADMIN';
  const facilities = await selectFacilities(database, { onlyActive });
  const result = [];

  for (const facility of facilities) {
    const openingHours = await selectOpeningHours(database, facility.id);
    result.push({ ...facility, openingHours });
  }

  return result;
}

// Creating a facility takes no lock because the row does not exist yet.
export async function createFacility(actor, body, requestId) {
  requireAdmin(actor);
  requireJsonObject(body);
  rejectUnknownFields(body, ['name', 'description', 'locationDescription']);

  const name = readText(body, 'name', { min: 1, max: 100 });
  const locationDescription = readText(body, 'locationDescription', { min: 1, max: 200 });
  const description =
    readText(body, 'description', { min: 0, max: 1000, optional: true }) ?? '';

  const facility = await withTransaction((client) =>
    insertFacility(client, { name, description, locationDescription })
  );

  logAction({
    requestId,
    action: 'FACILITY_CREATE',
    outcome: 'SUCCESS',
    actorId: actor.id,
    facilityId: facility.id
  });

  return { ...facility, openingHours: [] };
}
