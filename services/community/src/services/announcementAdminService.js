import { getDatabase, withTransaction } from '../config/database.js';
import {
  insertAnnouncement,
  lockAnnouncement,
  selectAnnouncementForAdmin,
  selectReadReceipts,
  updateAnnouncement
} from '../repositories/announcementRepository.js';
import {
  EDITABLE_FIELDS,
  effectiveStatus,
  mapReferenceError,
  notFound,
  optionalTimestamp,
  requireNotPast,
  storedStatusFor,
  toIso,
  validateAudience,
  validateBodyText,
  validateTitle,
  validateWindow
} from './announcementRules.js';
import { httpError } from '../utils/httpError.js';
import { logAction } from '../utils/logger.js';
import {
  invalidInput,
  requireBody,
  requireTimestamp,
  requireUuid
} from '../utils/validation.js';

const defaultDeps = {
  insertAnnouncement: (announcement) =>
    insertAnnouncement(getDatabase(), announcement),
  lockAnnouncement,
  updateAnnouncement,
  selectAnnouncementForAdmin: (id) => selectAnnouncementForAdmin(getDatabase(), id),
  selectReadReceipts: (id) => selectReadReceipts(getDatabase(), id),
  transaction: (work) => withTransaction(work)
};

const DRAFT_FIELDS = ['title', 'body', 'audienceType', 'buildingId', 'publishAt', 'expiresAt'];

export async function createAnnouncementDraft(
  { user, body, requestId },
  deps = defaultDeps
) {
  requireBody(body, DRAFT_FIELDS);

  const draft = {
    title: validateTitle(body.title),
    body: validateBodyText(body.body),
    ...validateAudience(body.audienceType, body.buildingId),
    // A draft may carry a planned window; it is checked again on approval.
    publishAt: optionalTimestamp(body.publishAt, 'publishAt') ?? null,
    expiresAt: optionalTimestamp(body.expiresAt, 'expiresAt') ?? null,
    createdBy: user.id,
    maintenanceRequestId: null
  };

  validateWindow(draft);

  let created;

  try {
    created = await deps.insertAnnouncement(draft);
  } catch (error) {
    throw mapReferenceError(error);
  }

  logAction({
    requestId,
    action: 'ANNOUNCEMENT_CREATE',
    outcome: 'SUCCEEDED',
    userId: user.id,
    announcementId: created.id,
    audienceType: created.audienceType
  });

  return created;
}

export async function editAnnouncement(
  { user, announcementId, body, requestId, now = new Date() },
  deps = defaultDeps
) {
  const id = requireUuid(announcementId, 'id');
  requireBody(body, DRAFT_FIELDS);

  const fields = Object.keys(body);

  if (fields.length === 0) {
    throw invalidInput('Provide at least one field to change.');
  }

  const updated = await deps.transaction(async (client) => {
    const current = await deps.lockAnnouncement(client, id);

    if (!current) {
      throw notFound();
    }

    const status = effectiveStatus(current, now);
    const allowed = EDITABLE_FIELDS[status];
    const blocked = fields.filter((field) => !allowed.includes(field));

    if (blocked.length > 0) {
      throw httpError(
        409,
        'ANNOUNCEMENT_NOT_EDITABLE',
        status + ' announcements cannot change ' + blocked.join(', ') + '.'
      );
    }

    const next = {
      title: current.title,
      body: current.body,
      audienceType: current.audienceType,
      buildingId: current.buildingId,
      publishAt: toIso(current.publishAt),
      expiresAt: toIso(current.expiresAt),
      approvedBy: current.approvedBy,
      storedStatus: current.storedStatus
    };

    if ('title' in body) next.title = validateTitle(body.title);
    if ('body' in body) next.body = validateBodyText(body.body);

    if ('audienceType' in body || 'buildingId' in body) {
      const audienceType = body.audienceType ?? current.audienceType;
      const buildingId = 'buildingId' in body
        ? body.buildingId
        : (audienceType === 'ALL' ? null : current.buildingId);

      Object.assign(next, validateAudience(audienceType, buildingId));
    }

    if ('publishAt' in body) {
      next.publishAt = optionalTimestamp(body.publishAt, 'publishAt');

      if (status !== 'DRAFT') {
        if (next.publishAt === null) {
          throw invalidInput('An approved announcement requires publishAt.');
        }
        requireNotPast(next.publishAt, 'publishAt', now);
      }
    }

    if ('expiresAt' in body) {
      next.expiresAt = optionalTimestamp(body.expiresAt, 'expiresAt');

      if (status !== 'DRAFT' && next.expiresAt !== null) {
        requireNotPast(next.expiresAt, 'expiresAt', now);
      }
    }

    validateWindow(next);

    if (status !== 'DRAFT') {
      next.storedStatus = storedStatusFor(next, now);
    }

    try {
      return await deps.updateAnnouncement(client, id, next);
    } catch (error) {
      throw mapReferenceError(error);
    }
  });

  logAction({
    requestId,
    action: 'ANNOUNCEMENT_EDIT',
    outcome: 'SUCCEEDED',
    userId: user.id,
    announcementId: id,
    fields
  });

  return updated;
}

// Admin approval. Publishes now or schedules for a future publishAt.
export async function approveAnnouncement(
  { user, announcementId, body, requestId, now = new Date() },
  deps = defaultDeps
) {
  const id = requireUuid(announcementId, 'id');
  const input = requireBody(body ?? {}, ['publishAt', 'expiresAt']);

  const approved = await deps.transaction(async (client) => {
    const current = await deps.lockAnnouncement(client, id);

    if (!current) {
      throw notFound();
    }

    if (current.storedStatus !== 'DRAFT') {
      throw httpError(
        409,
        'ANNOUNCEMENT_ALREADY_APPROVED',
        'Only draft announcements can be approved.'
      );
    }

    let publishAt;

    if (input.publishAt !== undefined) {
      publishAt = requireTimestamp(input.publishAt, 'publishAt');
      requireNotPast(publishAt, 'publishAt', now);
    } else if (current.publishAt && new Date(current.publishAt) > now) {
      publishAt = toIso(current.publishAt);
    } else {
      publishAt = now.toISOString();
    }

    const expiresAt = 'expiresAt' in input
      ? optionalTimestamp(input.expiresAt, 'expiresAt')
      : toIso(current.expiresAt);

    if (expiresAt !== null && Date.parse(expiresAt) <= now.getTime()) {
      throw invalidInput('expiresAt must be in the future.');
    }

    validateWindow({ publishAt, expiresAt });

    return deps.updateAnnouncement(client, id, {
      title: current.title,
      body: current.body,
      audienceType: current.audienceType,
      buildingId: current.buildingId,
      publishAt,
      expiresAt,
      approvedBy: user.id,
      storedStatus: storedStatusFor({ publishAt, expiresAt }, now)
    });
  });

  logAction({
    requestId,
    action: 'ANNOUNCEMENT_APPROVE',
    outcome: 'SUCCEEDED',
    userId: user.id,
    announcementId: id,
    status: approved.status
  });

  return approved;
}

export async function listReadReceipts({ announcementId }, deps = defaultDeps) {
  const id = requireUuid(announcementId, 'id');
  const announcement = await deps.selectAnnouncementForAdmin(id);

  if (!announcement) {
    throw notFound();
  }

  const reads = await deps.selectReadReceipts(id);

  return { announcementId: id, readCount: reads.length, reads };
}
