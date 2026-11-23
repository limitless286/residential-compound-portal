import { httpError } from '../utils/httpError.js';
import {
  findNotificationRecipient
} from '../repositories/internalIdentityRepository.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function lookupNotificationRecipient(user, body, query) {
  if (!user) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }

  if (!['ADMIN', 'RESIDENT'].includes(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission.');
  }

  if (Object.keys(query).length > 0) {
    throw httpError(
      400,
      'INVALID_INPUT',
      'Query parameters are not accepted.'
    );
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'INVALID_INPUT', 'Body must be a JSON object.');
  }

  if (Object.keys(body).some((field) => field !== 'userId')) {
    throw httpError(400, 'INVALID_INPUT', 'Only userId is accepted.');
  }

  if (typeof body.userId !== 'string' || !uuidPattern.test(body.userId)) {
    throw httpError(400, 'INVALID_INPUT', 'userId must be a valid UUID.');
  }

  const userId = body.userId.toLowerCase();

  if (user.role === 'RESIDENT' && userId !== user.id) {
    throw httpError(
      403,
      'FORBIDDEN',
      'Residents can request only their own recipient details.'
    );
  }

  const recipient = await findNotificationRecipient(userId);

  if (!recipient) {
    throw httpError(
      404,
      'RECIPIENT_NOT_FOUND',
      'An eligible notification recipient was not found.'
    );
  }

  return recipient;
}
