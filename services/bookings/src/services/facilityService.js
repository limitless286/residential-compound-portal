import { database, withTransaction } from '../config/database.js';
import {
  deleteOpeningHours,
  insertFacility,
  insertOpeningHour,
  selectFacilities,
  selectFacilityByIdForUpdate,
  selectOpeningHours,
  updateFacility
} from '../repositories/facilityRepository.js';
import { httpError } from '../utils/httpError.js';
import { logAction } from '../utils/logger.js';
import {
  invalidInput,
  readInteger,
  readText,
  rejectUnknownFields,
  requireJsonObject,
  validateUuid
} from '../utils/validation.js';

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

function readTime(entry, field) {
  const value = entry[field];

  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw invalidInput(`${field} must use the 24-hour format HH:MM.`);
  }

  return value;
}

// Validates everything first, then takes the facility lock (b) before writing.
export async function editFacility(actor, facilityId, body, requestId) {
  requireAdmin(actor);
  const id = validateUuid(facilityId, 'facilityId');
  requireJsonObject(body);
  rejectUnknownFields(body, ['name', 'description', 'locationDescription', 'status']);

  if (Object.keys(body).length === 0) {
    throw invalidInput('At least one field must be provided.');
  }

  const changes = {};

  if (body.name !== undefined) {
    changes.name = readText(body, 'name', { min: 1, max: 100 });
  }

  if (body.description !== undefined) {
    changes.description = readText(body, 'description', { min: 0, max: 1000 });
  }

  if (body.locationDescription !== undefined) {
    changes.locationDescription = readText(body, 'locationDescription', { min: 1, max: 200 });
  }

  if (body.status !== undefined) {
    if (body.status !== 'ACTIVE' && body.status !== 'INACTIVE') {
      throw invalidInput('status must be ACTIVE or INACTIVE.');
    }
    changes.status = body.status;
  }

  const facility = await withTransaction(async (client) => {
    const existing = await selectFacilityByIdForUpdate(client, id);
    if (!existing) {
      throw httpError(404, 'FACILITY_NOT_FOUND', 'Facility not found.');
    }

    const updated = await updateFacility(client, id, changes);
    const openingHours = await selectOpeningHours(client, id);
    return { ...updated, openingHours };
  });

  logAction({
    requestId,
    action: 'FACILITY_UPDATE',
    outcome: 'SUCCESS',
    actorId: actor.id,
    facilityId: id,
    changedFields: Object.keys(changes)
  });

  return facility;
}

// Validates the whole schedule first, then takes the facility lock (b)
// before replacing the rows one at a time in day order.
export async function replaceFacilityOpeningHours(actor, facilityId, body, requestId) {
  requireAdmin(actor);
  const id = validateUuid(facilityId, 'facilityId');
  requireJsonObject(body);
  rejectUnknownFields(body, ['openingHours']);

  if (!Array.isArray(body.openingHours)) {
    throw invalidInput('openingHours must be an array.');
  }

  if (body.openingHours.length > 7) {
    throw invalidInput('openingHours can contain at most 7 entries.');
  }

  const entries = [];
  const seenDays = new Set();

  for (const entry of body.openingHours) {
    requireJsonObject(entry, 'Each opening hours entry');
    rejectUnknownFields(entry, ['dayOfWeek', 'opensAt', 'closesAt']);

    const dayOfWeek = readInteger(entry, 'dayOfWeek', { min: 0, max: 6 });
    const opensAt = readTime(entry, 'opensAt');
    const closesAt = readTime(entry, 'closesAt');

    if (closesAt <= opensAt) {
      throw invalidInput('closesAt must be later than opensAt.');
    }

    if (seenDays.has(dayOfWeek)) {
      throw invalidInput('dayOfWeek must not repeat.');
    }

    seenDays.add(dayOfWeek);
    entries.push({ dayOfWeek, opensAt, closesAt });
  }

  entries.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  const result = await withTransaction(async (client) => {
    const existing = await selectFacilityByIdForUpdate(client, id);
    if (!existing) {
      throw httpError(404, 'FACILITY_NOT_FOUND', 'Facility not found.');
    }

    await deleteOpeningHours(client, id);

    for (const entry of entries) {
      await insertOpeningHour(client, {
        facilityId: id,
        dayOfWeek: entry.dayOfWeek,
        opensAt: entry.opensAt,
        closesAt: entry.closesAt
      });
    }

    const openingHours = await selectOpeningHours(client, id);
    return { ...existing, openingHours };
  });

  logAction({
    requestId,
    action: 'FACILITY_HOURS_REPLACE',
    outcome: 'SUCCESS',
    actorId: actor.id,
    facilityId: id,
    dayCount: entries.length
  });

  return result;
}
