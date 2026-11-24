// MOCKED tests for resident visibility and read receipts. The SQL
// visibility rule itself is checked against Neon in
// scripts/checkAnnouncements.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAnnouncement,
  listAnnouncements,
  markAnnouncementRead
} from '../src/services/announcementReadService.js';
import {
  createMaintenanceDraft,
  validateMaintenanceDraft
} from '../src/services/announcementDraftService.js';
import { createFakeStore } from './helpers/fakeStore.js';

const ID = '88888888-8888-4888-8888-888888888888';
const BUILDING = '22222222-2222-4222-8222-222222222222';
const OTHER_BUILDING = '33333333-3333-4333-8333-333333333333';
const RESIDENT = { id: 'resident-1', role: 'RESIDENT', unitId: 'u', buildingId: BUILDING };
const ADMIN = { id: '99999999-9999-4999-8999-999999999999', role: 'ADMIN' };

test('residents get their audience from the session only', async () => {
  const captured = [];
  await listAnnouncements({ user: RESIDENT, query: {} }, {
    selectVisibleAnnouncements: async (filters) => {
      captured.push(filters);
      return { announcements: [], hasMore: false };
    }
  });

  assert.deepEqual(captured[0], { userId: 'resident-1', buildingId: BUILDING, limit: 20, offset: 0 });
});

test('residents cannot filter by building or status', async () => {
  for (const query of [{ buildingId: OTHER_BUILDING }, { status: 'DRAFT' }, { audienceType: 'BUILDING' }]) {
    await assert.rejects(
      listAnnouncements({ user: RESIDENT, query }, { selectVisibleAnnouncements: async () => ({}) }),
      (error) => error.status === 400
    );
  }
});

test('admins can filter by status, audience and building', async () => {
  const captured = [];
  await listAnnouncements({
    user: ADMIN,
    query: { status: 'DRAFT', audienceType: 'BUILDING', buildingId: BUILDING }
  }, {
    selectAnnouncementsForAdmin: async (filters) => {
      captured.push(filters);
      return { announcements: [], hasMore: false };
    }
  });

  assert.equal(captured[0].status, 'DRAFT');
  assert.equal(captured[0].buildingId, BUILDING);
});

test('an announcement outside the resident audience or window is not found', async () => {
  await assert.rejects(
    getAnnouncement({ user: RESIDENT, announcementId: ID }, {
      selectVisibleAnnouncement: async () => null
    }),
    (error) => error.status === 404 && error.code === 'ANNOUNCEMENT_NOT_FOUND'
  );
});

test('a read receipt is recorded once and repeated reads are idempotent', async () => {
  const reads = new Map();
  const deps = {
    insertReadReceipt: async ({ userId, announcementId }) => {
      const key = userId + announcementId;
      const firstRead = !reads.has(key);
      if (firstRead) reads.set(key, '2026-11-25T10:00:00.000Z');
      return { eligible: true, readAt: reads.get(key), firstRead };
    }
  };

  const first = await markAnnouncementRead({ user: RESIDENT, announcementId: ID }, deps);
  const second = await markAnnouncementRead({ user: RESIDENT, announcementId: ID }, deps);

  assert.equal(first.firstRead, true);
  assert.equal(second.firstRead, false);
  assert.equal(second.readAt, first.readAt);
  assert.equal(reads.size, 1);
});

test('an ineligible resident cannot record a read receipt', async () => {
  await assert.rejects(
    markAnnouncementRead({ user: RESIDENT, announcementId: ID }, {
      insertReadReceipt: async () => ({ eligible: false, readAt: null, firstRead: false })
    }),
    (error) => error.status === 404
  );
});

const DRAFT_BODY = {
  maintenanceRequestId: '44444444-4444-4444-8444-444444444444',
  title: 'Facility maintenance',
  body: 'The facility will be temporarily unavailable during maintenance.',
  audienceType: 'ALL',
  buildingId: null
};

test('internal drafts reject publication and authorship fields', () => {
  for (const extra of [
    { status: 'PUBLISHED' }, { approvedBy: ADMIN.id }, { createdBy: ADMIN.id },
    { publishAt: '2026-12-01T10:00:00Z' }, { expiresAt: '2026-12-02T10:00:00Z' }
  ]) {
    assert.throws(() => validateMaintenanceDraft({ ...DRAFT_BODY, ...extra }),
      (error) => error.status === 400, JSON.stringify(extra));
  }

  assert.throws(() => validateMaintenanceDraft({ ...DRAFT_BODY, audienceType: 'BUILDING' }),
    (error) => error.status === 400);
  assert.throws(() => validateMaintenanceDraft({ ...DRAFT_BODY, maintenanceRequestId: 'x' }),
    (error) => error.status === 400);
});

function draftSetup() {
  const store = createFakeStore();
  const inserts = [];

  return {
    inserts,
    deps: {
      idempotency: store.idempotency,
      insertAnnouncement: async (client, draft) => {
        inserts.push(draft);
        return {
          id: 'ann-' + inserts.length,
          maintenanceRequestId: draft.maintenanceRequestId,
          audienceType: draft.audienceType,
          buildingId: draft.buildingId
        };
      }
    }
  };
}

function runDraft(deps, body, key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
  return createMaintenanceDraft({
    user: ADMIN, callerService: 'maintenance', idempotencyKey: key, body, requestId: 'r'
  }, deps);
}

test('internal drafts are always DRAFT with the admin as author and no window', async () => {
  const { deps, inserts } = draftSetup();
  const result = await runDraft(deps, DRAFT_BODY);

  assert.equal(result.status, 201);
  assert.deepEqual(result.data, {
    announcementId: 'ann-1',
    maintenanceRequestId: DRAFT_BODY.maintenanceRequestId,
    status: 'DRAFT',
    audienceType: 'ALL',
    buildingId: null
  });
  assert.equal(inserts[0].createdBy, ADMIN.id);
  assert.equal(inserts[0].publishAt, null);
  assert.equal(inserts[0].expiresAt, null);
});

test('internal draft retries replay; a changed payload conflicts', async () => {
  const { deps, inserts } = draftSetup();
  const first = await runDraft(deps, DRAFT_BODY);
  const retry = await runDraft(deps, DRAFT_BODY);

  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.data, first.data);
  assert.equal(inserts.length, 1);

  await assert.rejects(
    runDraft(deps, { ...DRAFT_BODY, title: 'Different title' }),
    (error) => error.status === 409 && error.code === 'IDEMPOTENCY_CONFLICT'
  );
});
