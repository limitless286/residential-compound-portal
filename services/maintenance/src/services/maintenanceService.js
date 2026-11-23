import { httpError } from '../utils/httpError.js';
import {
  validateCreateMaintenanceRequest
} from './maintenanceValidation.js';
import {
  createMaintenanceRequest
} from '../repositories/maintenanceRepository.js';

export async function submitMaintenanceRequest(user, body) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'RESIDENT') {
    throw httpError(
      403,
      'FORBIDDEN',
      'Only residents can submit maintenance requests.'
    );
  }

  if (!user.id || !user.unitId) {
    throw httpError(
      403,
      'UNIT_REQUIRED',
      'An active resident unit is required.'
    );
  }

  const input = validateCreateMaintenanceRequest(body);

  if (input.facilityId !== null) {
    throw httpError(
      503,
      'FACILITY_VALIDATION_UNAVAILABLE',
      'Facility-linked requests are not available yet.'
    );
  }

  try {
    return await createMaintenanceRequest({
      ...input,
      userId: user.id,
      unitId: user.unitId
    });
  } catch (error) {
    if (error.code === '23503') {
      throw httpError(
        409,
        'RELATED_DATA_CHANGED',
        'Related account or unit data changed. Please sign in again.'
      );
    }

    throw error;
  }
}
