import { httpError } from './httpError.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export function invalidInput(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function rejectUnknownFields(source, allowedFields, label) {
  const unknown = Object.keys(source)
    .filter((field) => !allowedFields.includes(field));

  if (unknown.length > 0) {
    throw invalidInput(
      'Unknown ' + label + ': ' + unknown[0].slice(0, 50) + '.'
    );
  }
}

export function requireBody(body, allowedFields) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidInput('Request body must be a JSON object.');
  }

  rejectUnknownFields(body, allowedFields, 'field');
  return body;
}

export function requireQuery(query, allowedFields) {
  const source = query || {};
  rejectUnknownFields(source, allowedFields, 'query parameter');

  for (const [field, value] of Object.entries(source)) {
    if (typeof value !== 'string') {
      throw invalidInput(field + ' must be a single value.');
    }
  }

  return source;
}

export function requireUuid(value, field) {
  if (!isUuid(value)) {
    throw invalidInput(field + ' must be a valid UUID.');
  }

  return value.toLowerCase();
}

export function requireInteger(value, field, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalidInput(
      field + ' must be an integer between ' + min + ' and ' + max + '.'
    );
  }

  return value;
}

export function requireText(value, field, { min, max }) {
  if (typeof value !== 'string') {
    throw invalidInput(field + ' must be text.');
  }

  const trimmed = value.trim();

  if (trimmed.length < min || trimmed.length > max) {
    throw invalidInput(
      field + ' must contain ' + min + ' to ' + max + ' characters.'
    );
  }

  return trimmed;
}

export function requireEnum(value, field, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw invalidInput(
      field + ' must be one of: ' + allowedValues.join(', ') + '.'
    );
  }

  return value;
}

export function parseBillingPeriod(value, field = 'billingPeriod') {
  if (typeof value !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw invalidInput(field + ' must use the YYYY-MM format.');
  }

  const year = Number(value.slice(0, 4));

  if (year < 2000 || year > 2100) {
    throw invalidInput(field + ' year must be between 2000 and 2100.');
  }

  return { billingPeriod: value, periodStart: value + '-01' };
}

export function requireTimestamp(value, field) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    throw invalidInput(
      field + ' must be an ISO 8601 timestamp with a timezone.'
    );
  }

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const time = Date.parse(value);

  if (calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day ||
      !Number.isFinite(time)) {
    throw invalidInput(field + ' is not a valid date and time.');
  }

  return new Date(time).toISOString();
}

export function requireIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');

  if (key === undefined) {
    throw httpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header is required.'
    );
  }

  if (!isUuid(key)) {
    throw httpError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be a UUID.'
    );
  }

  return key.toLowerCase();
}
