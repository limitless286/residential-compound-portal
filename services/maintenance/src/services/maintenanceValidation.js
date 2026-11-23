import { httpError } from '../utils/httpError.js';

const allowedFields = new Set([
  'title',
  'description',
  'category',
  'locationDescription',
  'facilityId'
]);

const categories = new Set([
  'PLUMBING',
  'ELECTRICAL',
  'CLEANING',
  'STRUCTURAL',
  'OTHER'
]);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

function readText(body, field, minimum, maximum) {
  if (typeof body[field] !== 'string') {
    throw invalid(`${field} must be a string.`);
  }

  const value = body[field].trim();
  const length = Array.from(value).length;

  if (length < minimum || length > maximum) {
    throw invalid(
      `${field} must contain between ${minimum} and ${maximum} characters.`
    );
  }

  if (value.includes('\u0000')) {
    throw invalid(`${field} contains an invalid character.`);
  }

  return value;
}

export function validateRequestId(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw invalid('Request id must be a valid UUID.');
  }

  return value.toLowerCase();
}

export function validateCreateMaintenanceRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Request body must be a JSON object.');
  }

  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      throw invalid(`Unknown field: ${field}.`);
    }
  }

  const title = readText(body, 'title', 3, 150);
  const description = readText(body, 'description', 10, 5000);
  const locationDescription = readText(
    body,
    'locationDescription',
    1,
    200
  );

  if (typeof body.category !== 'string' ||
      !categories.has(body.category)) {
    throw invalid(
      'category must be PLUMBING, ELECTRICAL, CLEANING, STRUCTURAL, or OTHER.'
    );
  }

  let facilityId = null;

  if (body.facilityId !== undefined && body.facilityId !== null) {
    if (typeof body.facilityId !== 'string' ||
        !uuidPattern.test(body.facilityId)) {
      throw invalid('facilityId must be a valid UUID or null.');
    }

    facilityId = body.facilityId.toLowerCase();
  }

  return {
    title,
    description,
    category: body.category,
    locationDescription,
    facilityId
  };
}
