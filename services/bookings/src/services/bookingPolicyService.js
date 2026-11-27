import { database, withTransaction } from '../config/database.js';
import {
  selectBookingPolicy,
  updateBookingPolicy
} from '../repositories/bookingPolicyRepository.js';
import { httpError } from '../utils/httpError.js';
import { logAction } from '../utils/logger.js';
import {
  invalidInput,
  readInteger,
  rejectUnknownFields,
  requireJsonObject
} from '../utils/validation.js';

const POLICY_FIELDS = Object.freeze([
  'maxFutureBookingsPerUnit',
  'advanceDays',
  'cancellationCutoffMinutes',
  'allowedDurationMinutes'
]);
const MAX_FUTURE_BOOKINGS_LIMITS = Object.freeze({ min: 1, max: 10 });
const ADVANCE_DAYS_LIMITS = Object.freeze({ min: 1, max: 90 });
const CANCELLATION_CUTOFF_LIMITS = Object.freeze({ min: 0, max: 1440 });
const DURATION_COUNT_LIMITS = Object.freeze({ min: 1, max: 6 });
const DURATION_MINUTES_LIMITS = Object.freeze({ min: 15, max: 480 });

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

function readDurations(body) {
  const durations = body.allowedDurationMinutes;

  if (!Array.isArray(durations)) {
    throw invalidInput('allowedDurationMinutes must be an array.');
  }

  if (
    durations.length < DURATION_COUNT_LIMITS.min ||
    durations.length > DURATION_COUNT_LIMITS.max
  ) {
    throw invalidInput(
      `allowedDurationMinutes must contain between ${DURATION_COUNT_LIMITS.min} and ${DURATION_COUNT_LIMITS.max} values.`
    );
  }

  for (const minutes of durations) {
    if (
      !Number.isInteger(minutes) ||
      minutes < DURATION_MINUTES_LIMITS.min ||
      minutes > DURATION_MINUTES_LIMITS.max
    ) {
      throw invalidInput(
        `allowedDurationMinutes must contain whole numbers between ${DURATION_MINUTES_LIMITS.min} and ${DURATION_MINUTES_LIMITS.max}.`
      );
    }
  }

  if (new Set(durations).size !== durations.length) {
    throw invalidInput('allowedDurationMinutes must not contain duplicates.');
  }

  return [...durations].sort((a, b) => a - b);
}

export async function getBookingPolicy(actor) {
  requireActor(actor);
  requireAdmin(actor);

  return selectBookingPolicy(database);
}

// A policy update takes no lock: it is a single-row update (see the protocol doc).
export async function replaceBookingPolicy(actor, body, requestId) {
  requireActor(actor);
  requireAdmin(actor);
  requireJsonObject(body);
  rejectUnknownFields(body, POLICY_FIELDS);

  for (const field of POLICY_FIELDS) {
    if (body[field] === undefined) {
      throw invalidInput(`${field} is required.`);
    }
  }

  const policy = {
    maxFutureBookingsPerUnit: readInteger(body, 'maxFutureBookingsPerUnit', MAX_FUTURE_BOOKINGS_LIMITS),
    advanceDays: readInteger(body, 'advanceDays', ADVANCE_DAYS_LIMITS),
    cancellationCutoffMinutes: readInteger(body, 'cancellationCutoffMinutes', CANCELLATION_CUTOFF_LIMITS),
    allowedDurationMinutes: readDurations(body)
  };

  const saved = await withTransaction((client) => updateBookingPolicy(client, policy));

  logAction({
    requestId,
    action: 'BOOKING_POLICY_UPDATE',
    outcome: 'SUCCESS',
    actorId: actor.id
  });

  return saved;
}
