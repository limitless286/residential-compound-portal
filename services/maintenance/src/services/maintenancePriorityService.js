import { httpError } from '../utils/httpError.js';
import { validateRequestId } from './maintenanceValidation.js';
import {
  updateMaintenancePriority
} from '../repositories/maintenanceRepository.js';

export async function changeMaintenancePriority(user, requestId, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  const id = validateRequestId(requestId);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'INVALID_INPUT', 'Body must be a JSON object.');
  }

  if (Object.keys(body).some(
    (field) => !['priority', 'reason'].includes(field)
  )) {
    throw httpError(
      400,
      'INVALID_INPUT',
      'Only priority and reason are accepted.'
    );
  }

  if (!['HIGH', 'MEDIUM', 'LOW'].includes(body.priority)) {
    throw httpError(
      400,
      'INVALID_INPUT',
      'priority must be HIGH, MEDIUM, or LOW.'
    );
  }

  if (typeof body.reason !== 'string') {
    throw httpError(400, 'INVALID_INPUT', 'reason is required.');
  }

  const reason = body.reason.trim();
  const length = Array.from(reason).length;

  if (length < 3 || length > 1000 || reason.includes('\u0000')) {
    throw httpError(
      400,
      'INVALID_INPUT',
      'reason must contain 3 to 1000 valid characters.'
    );
  }

  return updateMaintenancePriority({
    id,
    actorUserId: user.id,
    priority: body.priority,
    reason
  });
}
