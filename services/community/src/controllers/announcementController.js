import {
  approveAnnouncement,
  createAnnouncementDraft,
  editAnnouncement,
  listReadReceipts
} from '../services/announcementAdminService.js';
import {
  getAnnouncement,
  listAnnouncements,
  markAnnouncementRead
} from '../services/announcementReadService.js';
import { createMaintenanceDraft } from '../services/announcementDraftService.js';
import { requireIdempotencyKey } from '../utils/validation.js';

function send(res, req, status, data) {
  res.status(status).json({ data, requestId: req.requestId });
}

export async function readAnnouncements(req, res) {
  send(res, req, 200, await listAnnouncements({ user: req.auth.user, query: req.query }));
}

export async function readAnnouncement(req, res) {
  send(res, req, 200, await getAnnouncement({
    user: req.auth.user,
    announcementId: req.params.id
  }));
}

export async function recordAnnouncementRead(req, res) {
  send(res, req, 200, await markAnnouncementRead({
    user: req.auth.user,
    announcementId: req.params.id,
    requestId: req.requestId
  }));
}

export async function createAnnouncement(req, res) {
  send(res, req, 201, await createAnnouncementDraft({
    user: req.auth.user,
    body: req.body,
    requestId: req.requestId
  }));
}

export async function updateAnnouncement(req, res) {
  send(res, req, 200, await editAnnouncement({
    user: req.auth.user,
    announcementId: req.params.id,
    body: req.body,
    requestId: req.requestId
  }));
}

export async function publishAnnouncement(req, res) {
  send(res, req, 200, await approveAnnouncement({
    user: req.auth.user,
    announcementId: req.params.id,
    body: req.body,
    requestId: req.requestId
  }));
}

export async function readAnnouncementReceipts(req, res) {
  send(res, req, 200, await listReadReceipts({ announcementId: req.params.id }));
}

export async function createInternalDraft(req, res) {
  const idempotencyKey = requireIdempotencyKey(req);

  const result = await createMaintenanceDraft({
    user: req.auth.user,
    callerService: req.callingService,
    idempotencyKey,
    body: req.body,
    requestId: req.requestId
  });

  if (result.replayed) {
    res.setHeader('Idempotent-Replayed', 'true');
  }

  send(res, req, result.status, result.data);
}
