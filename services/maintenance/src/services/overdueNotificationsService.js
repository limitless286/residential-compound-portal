import { httpError } from '../utils/httpError.js';

export async function getOverdueNotifications(user, query, { listNotifications }) {
  if (!user) throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  if (user.role !== 'ADMIN') throw httpError(403, 'FORBIDDEN', 'Administrator access is required.');
  if (Object.keys(query).some(key => key !== 'limit') ||
      query.limit !== undefined && (
        typeof query.limit !== 'string' || !/^\d+$/.test(query.limit) ||
        !Number.isSafeInteger(Number(query.limit)) || Number(query.limit) < 1 || Number(query.limit) > 100
      )) throw httpError(400, 'INVALID_INPUT', 'limit must be an integer between 1 and 100.');
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  try {
    const rows = await listNotifications({ limit: limit + 1 });
    return {
      notifications: rows.slice(0, limit),
      pagination: { limit, hasMore: rows.length > limit }
    };
  } catch {
    throw httpError(503, 'NOTIFICATIONS_UNAVAILABLE', 'Maintenance notifications are temporarily unavailable.');
  }
}
