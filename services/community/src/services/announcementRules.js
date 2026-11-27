import { httpError } from '../utils/httpError.js';
import {
  invalidInput,
  requireEnum,
  requireText,
  requireTimestamp,
  requireUuid
} from '../utils/validation.js';

export const AUDIENCE_TYPES = ['ALL', 'BUILDING'];
export const ANNOUNCEMENT_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED'];

export const ANNOUNCEMENT_RULES = {
  titleMin: 3,
  titleMax: 150,
  bodyMin: 10,
  bodyMax: 10000,
  // Allowance for clock differences when a time is "now".
  pastToleranceMs: 5 * 60 * 1000
};

// Fields an admin may change in each effective status.
export const EDITABLE_FIELDS = {
  DRAFT: ['title', 'body', 'audienceType', 'buildingId', 'publishAt', 'expiresAt'],
  SCHEDULED: ['publishAt', 'expiresAt'],
  PUBLISHED: ['expiresAt'],
  EXPIRED: []
};

export function toIso(value) {
  return value === null || value === undefined
    ? null
    : new Date(value).toISOString();
}

export function effectiveStatus(announcement, now) {
  if (announcement.storedStatus === 'DRAFT' || !announcement.approvedBy) {
    return 'DRAFT';
  }

  const time = now.getTime();

  if (announcement.expiresAt && new Date(announcement.expiresAt).getTime() <= time) {
    return 'EXPIRED';
  }

  if (new Date(announcement.publishAt).getTime() > time) {
    return 'SCHEDULED';
  }

  return 'PUBLISHED';
}

export function storedStatusFor({ publishAt, expiresAt }, now) {
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) {
    return 'EXPIRED';
  }

  return Date.parse(publishAt) <= now.getTime() ? 'PUBLISHED' : 'SCHEDULED';
}

export function validateTitle(value) {
  return requireText(value, 'title', {
    min: ANNOUNCEMENT_RULES.titleMin,
    max: ANNOUNCEMENT_RULES.titleMax
  });
}

export function validateBodyText(value) {
  return requireText(value, 'body', {
    min: ANNOUNCEMENT_RULES.bodyMin,
    max: ANNOUNCEMENT_RULES.bodyMax
  });
}

// ALL requires buildingId to be absent or null; BUILDING requires a UUID.
export function validateAudience(audienceType, buildingId) {
  const type = requireEnum(audienceType, 'audienceType', AUDIENCE_TYPES);

  if (type === 'ALL') {
    if (buildingId !== undefined && buildingId !== null) {
      throw invalidInput('buildingId must be null when audienceType is ALL.');
    }

    return { audienceType: 'ALL', buildingId: null };
  }

  return { audienceType: 'BUILDING', buildingId: requireUuid(buildingId, 'buildingId') };
}

export function optionalTimestamp(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requireTimestamp(value, field);
}

export function validateWindow({ publishAt, expiresAt }) {
  if (expiresAt && !publishAt) {
    throw invalidInput('expiresAt requires publishAt.');
  }

  if (expiresAt && publishAt && Date.parse(expiresAt) <= Date.parse(publishAt)) {
    throw invalidInput('expiresAt must be after publishAt.');
  }
}

export function requireNotPast(value, field, now) {
  if (Date.parse(value) < now.getTime() - ANNOUNCEMENT_RULES.pastToleranceMs) {
    throw invalidInput(field + ' cannot be in the past.');
  }
}

// Maps foreign-key failures to safe 400 responses.
export function mapReferenceError(error) {
  if (error?.code !== '23503') {
    return error;
  }

  if (String(error.constraint).includes('building')) {
    return invalidInput('buildingId does not reference an existing building.');
  }

  if (String(error.constraint).includes('maintenance_request')) {
    return invalidInput(
      'maintenanceRequestId does not reference an existing maintenance request.'
    );
  }

  return error;
}

export function notFound() {
  return httpError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.');
}
