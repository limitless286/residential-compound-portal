import { httpError } from '../utils/httpError.js';
import {
  getMaintenanceOverview
} from '../repositories/maintenanceOverviewRepository.js';

export async function readMaintenanceOverview(user, query) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (user.role !== 'ADMIN') {
    throw httpError(403, 'FORBIDDEN', 'Admin permission is required.');
  }

  if (Object.keys(query).length > 0) {
    throw httpError(
      400,
      'INVALID_INPUT',
      'This overview does not accept query parameters.'
    );
  }

  return getMaintenanceOverview();
}
