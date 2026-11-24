import { getDatabase } from '../config/database.js';
import {
  insertReadReceipt,
  selectAnnouncementForAdmin,
  selectAnnouncementsForAdmin,
  selectVisibleAnnouncement,
  selectVisibleAnnouncements
} from '../repositories/announcementRepository.js';
import {
  ANNOUNCEMENT_STATUSES,
  AUDIENCE_TYPES,
  notFound
} from './announcementRules.js';
import { logAction } from '../utils/logger.js';
import {
  invalidInput,
  requireEnum,
  requireQuery,
  requireUuid
} from '../utils/validation.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;

const defaultDeps = {
  selectAnnouncementsForAdmin: (filters) =>
    selectAnnouncementsForAdmin(getDatabase(), filters),
  selectAnnouncementForAdmin: (id) => selectAnnouncementForAdmin(getDatabase(), id),
  selectVisibleAnnouncements: (filters) =>
    selectVisibleAnnouncements(getDatabase(), filters),
  selectVisibleAnnouncement: (filters) =>
    selectVisibleAnnouncement(getDatabase(), filters),
  insertReadReceipt: (receipt) => insertReadReceipt(getDatabase(), receipt)
};

function parseBoundedInteger(value, field, defaultValue, min, max) {
  if (value === undefined) return defaultValue;

  if (!/^\d{1,6}$/.test(value) || Number(value) < min || Number(value) > max) {
    throw invalidInput(field + ' must be an integer between ' + min + ' and ' + max + '.');
  }

  return Number(value);
}

// The resident's audience comes only from the authenticated session.
function residentAudience(user) {
  return {
    userId: user.id,
    buildingId: user.buildingId ? user.buildingId.toLowerCase() : null
  };
}

export async function listAnnouncements({ user, query }, deps = defaultDeps) {
  const paging = ['limit', 'offset'];

  if (user.role === 'ADMIN') {
    requireQuery(query, ['status', 'audienceType', 'buildingId', ...paging]);
  } else {
    // Residents cannot widen their audience with filters.
    requireQuery(query, paging);
  }

  const limit = parseBoundedInteger(query.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseBoundedInteger(query.offset, 'offset', 0, 0, MAX_OFFSET);

  const result = user.role === 'ADMIN'
    ? await deps.selectAnnouncementsForAdmin({
      status: query.status === undefined
        ? undefined
        : requireEnum(query.status, 'status', ANNOUNCEMENT_STATUSES),
      audienceType: query.audienceType === undefined
        ? undefined
        : requireEnum(query.audienceType, 'audienceType', AUDIENCE_TYPES),
      buildingId: query.buildingId === undefined
        ? undefined
        : requireUuid(query.buildingId, 'buildingId'),
      limit,
      offset
    })
    : await deps.selectVisibleAnnouncements({
      ...residentAudience(user),
      limit,
      offset
    });

  return {
    announcements: result.announcements,
    limit,
    offset,
    nextOffset: result.hasMore ? offset + limit : null
  };
}

export async function getAnnouncement({ user, announcementId }, deps = defaultDeps) {
  const id = requireUuid(announcementId, 'id');

  const announcement = user.role === 'ADMIN'
    ? await deps.selectAnnouncementForAdmin(id)
    : await deps.selectVisibleAnnouncement({
      ...residentAudience(user),
      announcementId: id
    });

  // Drafts, scheduled, expired and other audiences look identical to a
  // resident: not found.
  if (!announcement) {
    throw notFound();
  }

  return announcement;
}

export async function markAnnouncementRead(
  { user, announcementId, requestId },
  deps = defaultDeps
) {
  const id = requireUuid(announcementId, 'id');

  const receipt = await deps.insertReadReceipt({
    ...residentAudience(user),
    announcementId: id
  });

  if (!receipt.eligible) {
    throw notFound();
  }

  if (receipt.firstRead) {
    logAction({
      requestId,
      action: 'ANNOUNCEMENT_READ',
      outcome: 'SUCCEEDED',
      userId: user.id,
      announcementId: id
    });
  }

  return {
    announcementId: id,
    readAt: receipt.readAt,
    firstRead: receipt.firstRead
  };
}
