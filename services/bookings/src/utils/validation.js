import { httpError } from './httpError.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const timestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function invalidInput(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

export function requireJsonObject(body, label = 'Request body') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidInput(`${label} must be a JSON object.`);
  }

  return body;
}

export function rejectUnknownFields(body, allowedFields) {
  const allowed = new Set(allowedFields);

  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) {
      throw invalidInput(`Unknown field: ${field}.`);
    }
  }
}

export function validateUuid(value, label = 'id') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw invalidInput(`${label} must be a valid UUID.`);
  }

  return value.toLowerCase();
}

export function readUuid(body, field, { optional = false } = {}) {
  if (optional && (body[field] === undefined || body[field] === null)) {
    return null;
  }

  return validateUuid(body[field], field);
}

export function readText(
  body,
  field,
  { min = 1, max, optional = false } = {}
) {
  if (optional && (body[field] === undefined || body[field] === null)) {
    return null;
  }

  if (typeof body[field] !== 'string') {
    throw invalidInput(`${field} must be a string.`);
  }

  const value = body[field].trim();
  const length = Array.from(value).length;

  if (length < min || length > max) {
    throw invalidInput(
      `${field} must contain between ${min} and ${max} characters.`
    );
  }

  if (value.includes('\u0000')) {
    throw invalidInput(`${field} contains an invalid character.`);
  }

  return value;
}

export function readInteger(body, field, { min, max }) {
  const value = body[field];

  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalidInput(
      `${field} must be a whole number between ${min} and ${max}.`
    );
  }

  return value;
}

// Accepts ISO 8601 timestamps that include a timezone and returns the
// instant normalized to UTC (for example 2026-12-01T08:00:00.000Z).
export function readTimestamp(body, field) {
  const value = body[field];

  if (typeof value !== 'string' || !timestampPattern.test(value)) {
    throw invalidInput(
      `${field} must be an ISO 8601 timestamp that includes a timezone.`
    );
  }

  // Date.parse rolls impossible dates (2026-02-31) forward instead of
  // rejecting them, so check every component explicitly.
  validateLocalDate(value.slice(0, 10), field);

  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = value[16] === ':' ? Number(value.slice(17, 19)) : 0;
  const offset = value.match(/[+-](\d{2}):(\d{2})$/);

  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))
  ) {
    throw invalidInput(`${field} is not a valid date and time.`);
  }

  const time = Date.parse(value);

  if (!Number.isFinite(time)) {
    throw invalidInput(`${field} is not a valid date and time.`);
  }

  return new Date(time).toISOString();
}

// Local calendar date as YYYY-MM-DD. Day and month ranges are checked.
export function validateLocalDate(value, label = 'date') {
  const match = typeof value === 'string'
    ? localDatePattern.exec(value)
    : null;

  if (!match) {
    throw invalidInput(`${label} must use the format YYYY-MM-DD.`);
  }

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw invalidInput(`${label} is not a valid calendar date.`);
  }

  return value;
}
