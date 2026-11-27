import { insertAnnouncement } from '../repositories/announcementRepository.js';
import {
  mapReferenceError,
  validateAudience,
  validateBodyText,
  validateTitle
} from './announcementRules.js';
import { executeIdempotent, idempotencyStore } from './idempotencyService.js';
import { logAction } from '../utils/logger.js';
import { requireBody, requireUuid } from '../utils/validation.js';

export const DRAFT_ENDPOINT = 'POST /internal/v1/announcements/drafts';

const defaultDeps = {
  insertAnnouncement,
  idempotency: idempotencyStore
};

// status, approvedBy, createdBy, publishAt and expiresAt are not accepted:
// unknown fields are rejected with 400, so this endpoint cannot publish
// or schedule.
export function validateMaintenanceDraft(body) {
  requireBody(body, ['maintenanceRequestId', 'title', 'body', 'audienceType', 'buildingId']);

  return {
    maintenanceRequestId: requireUuid(body.maintenanceRequestId, 'maintenanceRequestId'),
    title: validateTitle(body.title),
    body: validateBodyText(body.body),
    ...validateAudience(body.audienceType, body.buildingId)
  };
}

export async function createMaintenanceDraft(
  { user, callerService, idempotencyKey, body, requestId },
  deps = defaultDeps
) {
  const draft = validateMaintenanceDraft(body);

  const scope = {
    callerService,
    userId: user.id,
    endpoint: DRAFT_ENDPOINT,
    idempotencyKey
  };

  try {
    const result = await executeIdempotent({
      scope,
      payload: draft,
      // Draft and idempotency record are written in one transaction.
      perform: async (client) => {
        let created;

        try {
          created = await deps.insertAnnouncement(client, {
            ...draft,
            publishAt: null,
            expiresAt: null,
            createdBy: user.id
          });
        } catch (error) {
          throw mapReferenceError(error);
        }

        return {
          status: 201,
          data: {
            announcementId: created.id,
            maintenanceRequestId: created.maintenanceRequestId,
            status: 'DRAFT',
            audienceType: created.audienceType,
            buildingId: created.buildingId
          }
        };
      }
    }, deps.idempotency);

    logAction({
      requestId,
      action: 'ANNOUNCEMENT_DRAFT_INTERNAL',
      outcome: result.replayed ? 'REPLAYED' : 'SUCCEEDED',
      callerService,
      userId: user.id,
      announcementId: result.data.announcementId,
      maintenanceRequestId: draft.maintenanceRequestId
    });

    return result;
  } catch (error) {
    logAction({
      requestId,
      action: 'ANNOUNCEMENT_DRAFT_INTERNAL',
      outcome: 'FAILED',
      level: 'warn',
      callerService,
      userId: user.id,
      maintenanceRequestId: draft.maintenanceRequestId,
      code: error.code || 'UNKNOWN'
    });

    throw error;
  }
}
