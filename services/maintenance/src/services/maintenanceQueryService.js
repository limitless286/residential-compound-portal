import { httpError } from '../utils/httpError.js';
import { validateRequestId } from './maintenanceValidation.js';
import {
  listMaintenanceRequests,
  findMaintenanceRequestById,
  findMaintenanceRequestHistory
} from '../repositories/maintenanceRepository.js';

const statuses = new Set([
  'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'
]);

const priorities = new Set(['HIGH', 'MEDIUM', 'LOW']);

function requireUser(user) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (!['RESIDENT', 'ADMIN'].includes(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission.');
  }
}

function invalid(message) {
  return httpError(400, 'INVALID_INPUT', message);
}

function readInteger(value, fallback, minimum, maximum, field) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalid(`${field} must be an integer.`);
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) ||
      number < minimum || number > maximum) {
    throw invalid(`${field} must be between ${minimum} and ${maximum}.`);
  }

  return number;
}

export async function getMaintenanceRequests(user, query) {
  requireUser(user);

  const allowed = new Set(['status', 'priority', 'limit', 'offset']);

  for (const field of Object.keys(query)) {
    if (!allowed.has(field)) {
      throw invalid(`Unknown query parameter: ${field}.`);
    }
  }

  if (query.status !== undefined && !statuses.has(query.status)) {
    throw invalid('Invalid maintenance status.');
  }

  if (query.priority !== undefined && !priorities.has(query.priority)) {
    throw invalid('Invalid maintenance priority.');
  }

  return listMaintenanceRequests({
    userId: user.id,
    isAdmin: user.role === 'ADMIN',
    status: query.status ?? null,
    priority: query.priority ?? null,
    limit: readInteger(query.limit, 20, 1, 100, 'limit'),
    offset: readInteger(query.offset, 0, 0, 10000, 'offset')
  });
}

export async function getMaintenanceRequest(user, requestId) {
  requireUser(user);

  const id = validateRequestId(requestId);
  const request = await findMaintenanceRequestById(id);

  if (!request) {
    throw httpError(
      404,
      'REQUEST_NOT_FOUND',
      'Maintenance request not found.'
    );
  }

  if (user.role !== 'ADMIN' && request.userId !== user.id) {
    throw httpError(
      403,
      'FORBIDDEN',
      'You cannot access this maintenance request.'
    );
  }

  const history = await findMaintenanceRequestHistory(id);

  return { request, history };
}
