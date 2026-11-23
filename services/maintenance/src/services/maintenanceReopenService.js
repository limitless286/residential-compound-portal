import { httpError } from '../utils/httpError.js';
import { maintenancePolicy } from '../config/maintenancePolicy.js';
import { validateRequestId } from './maintenanceValidation.js';
import {
  reopenMaintenanceRequest
} from '../repositories/maintenanceRepository.js';

export async function reopenResidentRequest(user, requestId, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'RESIDENT') {
    throw httpError(403, 'FORBIDDEN', 'Resident permission is required.');
  }

  const id = validateRequestId(requestId);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'INVALID_INPUT', 'Body must be a JSON object.');
  }

  if (Object.keys(body).some((field) => field !== 'reason')) {
    throw httpError(400, 'INVALID_INPUT', 'Only reason is accepted.');
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

  return reopenMaintenanceRequest({
    id,
    userId: user.id,
    reason,
    reopenWindowHours: maintenancePolicy.reopenWindowHours
  });
}
