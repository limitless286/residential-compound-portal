import { httpError } from '../utils/httpError.js';
import { validateRequestId } from './maintenanceValidation.js';
import {
  transitionMaintenanceRequest
} from '../repositories/maintenanceRepository.js';

const adminActions = {
  start: {
    expectedStatus: 'OPEN',
    nextStatus: 'IN_PROGRESS',
    eventType: 'STARTED',
    requiresReason: false
  },
  resolve: {
    expectedStatus: 'IN_PROGRESS',
    nextStatus: 'RESOLVED',
    eventType: 'RESOLVED',
    requiresReason: true
  }
};

export async function performAdminMaintenanceAction(
  user,
  requestId,
  action,
  body
) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  if (!Object.hasOwn(adminActions, action)) {
    throw httpError(400, 'INVALID_ACTION', 'Invalid maintenance action.');
  }

  const policy = adminActions[action];
  const id = validateRequestId(requestId);

  // Bodyless actions may omit the JSON body entirely.
  const input = body === undefined ? {} : body;

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'INVALID_INPUT', 'Body must be a JSON object.');
  }

  const allowedFields = policy.requiresReason ? ['reason'] : [];

  for (const field of Object.keys(input)) {
    if (!allowedFields.includes(field)) {
      throw httpError(
        400,
        'INVALID_INPUT',
        `Unknown field: ${field}.`
      );
    }
  }

  let reason = null;

  if (policy.requiresReason) {
    if (typeof input.reason !== 'string') {
      throw httpError(400, 'INVALID_INPUT', 'reason is required.');
    }

    reason = input.reason.trim();
    const length = Array.from(reason).length;

    if (length < 3 || length > 1000 || reason.includes('\u0000')) {
      throw httpError(
        400,
        'INVALID_INPUT',
        'reason must contain 3 to 1000 valid characters.'
      );
    }
  }

  return transitionMaintenanceRequest({
    id,
    actorUserId: user.id,
    expectedStatus: policy.expectedStatus,
    nextStatus: policy.nextStatus,
    eventType: policy.eventType,
    reason
  });
}

export async function confirmMaintenanceResolution(user, requestId, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'RESIDENT') {
    throw httpError(
      403,
      'FORBIDDEN',
      'Only the resident who owns the request can confirm resolution.'
    );
  }

  const id = validateRequestId(requestId);
  const input = body === undefined ? {} : body;

  if (!input || typeof input !== 'object' ||
      Array.isArray(input) || Object.keys(input).length !== 0) {
    throw httpError(
      400,
      'INVALID_INPUT',
      'Confirmation accepts an empty JSON object only.'
    );
  }

  return transitionMaintenanceRequest({
    id,
    actorUserId: user.id,
    ownerUserId: user.id,
    expectedStatus: 'RESOLVED',
    nextStatus: 'CLOSED',
    eventType: 'CLOSED',
    reason: null
  });
}
