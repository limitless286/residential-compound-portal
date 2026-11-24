// MOCKED tests for announcement rules and admin workflow. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approveAnnouncement,
  createAnnouncementDraft,
  editAnnouncement
} from '../src/services/announcementAdminService.js';
import {
  effectiveStatus,
  validateAudience
} from '../src/services/announcementRules.js';

const ADMIN = { id: '99999999-9999-4999-8999-999999999999', role: 'ADMIN' };
const ID = '88888888-8888-4888-8888-888888888888';
const BUILDING = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-25T10:00:00Z');
const HOUR = 3600 * 1000;
const at = (offsetHours) => new Date(NOW.getTime() + offsetHours * HOUR).toISOString();

function stored(overrides = {}) {
  return {
    id: ID,
    title: 'Water outage',
    body: 'Water will be off for two hours.',
    audienceType: 'ALL',
    buildingId: null,
    storedStatus: 'DRAFT',
    publishAt: null,
    expiresAt: null,
    approvedBy: null,
    ...overrides
  };
}

function fakeDeps(current) {
  const calls = { updates: [], inserts: [] };

  return {
    calls,
    deps: {
      transaction: async (work) => work({ fake: true }),
      lockAnnouncement: async () => current,
      updateAnnouncement: async (client, id, fields) => {
        calls.updates.push(fields);
        return { id, ...fields };
      },
      insertAnnouncement: async (draft) => {
        calls.inserts.push(draft);
        return { id: ID, ...draft, status: 'DRAFT' };
      }
    }
  };
}

test('effective status follows approval and the publication window', () => {
  assert.equal(effectiveStatus(stored(), NOW), 'DRAFT');

  const approved = { storedStatus: 'SCHEDULED', approvedBy: ADMIN.id };
  assert.equal(effectiveStatus({ ...approved, publishAt: at(2) }, NOW), 'SCHEDULED');
  assert.equal(effectiveStatus({ ...approved, publishAt: at(-2) }, NOW), 'PUBLISHED');
  assert.equal(
    effectiveStatus({ ...approved, publishAt: at(-2), expiresAt: at(-1) }, NOW),
    'EXPIRED'
  );
});

test('audience rules: ALL has no building, BUILDING requires one', () => {
  assert.deepEqual(validateAudience('ALL', null), { audienceType: 'ALL', buildingId: null });
  assert.deepEqual(validateAudience('BUILDING', BUILDING), {
    audienceType: 'BUILDING', buildingId: BUILDING
  });
  assert.throws(() => validateAudience('ALL', BUILDING), (e) => e.status === 400);
  assert.throws(() => validateAudience('BUILDING', null), (e) => e.status === 400);
  assert.throws(() => validateAudience('UNIT', null), (e) => e.status === 400);
});

test('creating always produces a DRAFT and rejects status or approver input', async () => {
  const { deps, calls } = fakeDeps(null);
  const body = { title: 'Pool closed', body: 'The pool is closed today.', audienceType: 'ALL' };

  const created = await createAnnouncementDraft({ user: ADMIN, body }, deps);
  assert.equal(created.status, 'DRAFT');
  assert.equal(calls.inserts[0].createdBy, ADMIN.id);

  for (const extra of [{ status: 'PUBLISHED' }, { approvedBy: ADMIN.id }, { createdBy: ADMIN.id }]) {
    await assert.rejects(
      createAnnouncementDraft({ user: ADMIN, body: { ...body, ...extra } }, deps),
      (error) => error.status === 400
    );
  }
});

test('title, body and window are validated', async () => {
  const { deps } = fakeDeps(null);
  const base = { title: 'Pool closed', body: 'The pool is closed today.', audienceType: 'ALL' };

  for (const body of [
    { ...base, title: 'ab' },
    { ...base, body: 'too short' },
    { ...base, expiresAt: at(5) },
    { ...base, publishAt: at(5), expiresAt: at(4) },
    { ...base, publishAt: '2026-12-01T10:00:00' }
  ]) {
    await assert.rejects(createAnnouncementDraft({ user: ADMIN, body }, deps),
      (error) => error.status === 400, JSON.stringify(body));
  }
});

test('approval without publishAt publishes immediately', async () => {
  const { deps, calls } = fakeDeps(stored());
  await approveAnnouncement({ user: ADMIN, announcementId: ID, body: undefined, now: NOW }, deps);

  assert.equal(calls.updates[0].approvedBy, ADMIN.id);
  assert.equal(calls.updates[0].storedStatus, 'PUBLISHED');
  assert.equal(calls.updates[0].publishAt, NOW.toISOString());
});

test('approval with a future publishAt schedules', async () => {
  const { deps, calls } = fakeDeps(stored());
  await approveAnnouncement({
    user: ADMIN, announcementId: ID, body: { publishAt: at(24), expiresAt: at(48) }, now: NOW
  }, deps);

  assert.equal(calls.updates[0].storedStatus, 'SCHEDULED');
  assert.equal(calls.updates[0].expiresAt, at(48));
});

test('approval rejects past times and already approved announcements', async () => {
  await assert.rejects(
    approveAnnouncement({ user: ADMIN, announcementId: ID, body: { publishAt: at(-3) }, now: NOW },
      fakeDeps(stored()).deps),
    (error) => error.status === 400
  );
  await assert.rejects(
    approveAnnouncement({ user: ADMIN, announcementId: ID, body: { expiresAt: at(-1) }, now: NOW },
      fakeDeps(stored()).deps),
    (error) => error.status === 400
  );
  await assert.rejects(
    approveAnnouncement({ user: ADMIN, announcementId: ID, body: {}, now: NOW },
      fakeDeps(stored({ storedStatus: 'PUBLISHED', approvedBy: ADMIN.id, publishAt: at(-1) })).deps),
    (error) => error.status === 409 && error.code === 'ANNOUNCEMENT_ALREADY_APPROVED'
  );
  await assert.rejects(
    approveAnnouncement({ user: ADMIN, announcementId: ID, body: {}, now: NOW }, fakeDeps(null).deps),
    (error) => error.status === 404
  );
});

test('drafts can change content and audience', async () => {
  const { deps, calls } = fakeDeps(stored());
  await editAnnouncement({
    user: ADMIN,
    announcementId: ID,
    body: { title: 'New title', audienceType: 'BUILDING', buildingId: BUILDING },
    now: NOW
  }, deps);

  assert.equal(calls.updates[0].title, 'New title');
  assert.equal(calls.updates[0].buildingId, BUILDING);
  assert.equal(calls.updates[0].storedStatus, 'DRAFT');
});

test('switching a draft to ALL clears the building', async () => {
  const { deps, calls } = fakeDeps(stored({ audienceType: 'BUILDING', buildingId: BUILDING }));
  await editAnnouncement({ user: ADMIN, announcementId: ID, body: { audienceType: 'ALL' }, now: NOW }, deps);
  assert.equal(calls.updates[0].buildingId, null);
});

test('scheduled announcements may only change their window', async () => {
  const scheduled = stored({ storedStatus: 'SCHEDULED', approvedBy: ADMIN.id, publishAt: at(24) });

  await assert.rejects(
    editAnnouncement({ user: ADMIN, announcementId: ID, body: { title: 'Changed' }, now: NOW },
      fakeDeps(scheduled).deps),
    (error) => error.status === 409 && error.code === 'ANNOUNCEMENT_NOT_EDITABLE'
  );

  const { deps, calls } = fakeDeps(scheduled);
  await editAnnouncement({ user: ADMIN, announcementId: ID, body: { publishAt: at(-0.01) }, now: NOW }, deps);
  assert.equal(calls.updates[0].storedStatus, 'PUBLISHED');
});

test('published announcements may only change expiry, and can be ended now', async () => {
  const published = stored({ storedStatus: 'PUBLISHED', approvedBy: ADMIN.id, publishAt: at(-24) });

  for (const body of [{ body: 'Changed body text here' }, { audienceType: 'ALL' }, { publishAt: at(1) }]) {
    await assert.rejects(
      editAnnouncement({ user: ADMIN, announcementId: ID, body, now: NOW }, fakeDeps(published).deps),
      (error) => error.status === 409
    );
  }

  const { deps, calls } = fakeDeps(published);
  await editAnnouncement({ user: ADMIN, announcementId: ID, body: { expiresAt: NOW.toISOString() }, now: NOW }, deps);
  assert.equal(calls.updates[0].storedStatus, 'EXPIRED');
});

test('expired announcements cannot be edited', async () => {
  const expired = stored({
    storedStatus: 'PUBLISHED', approvedBy: ADMIN.id, publishAt: at(-48), expiresAt: at(-1)
  });

  await assert.rejects(
    editAnnouncement({ user: ADMIN, announcementId: ID, body: { expiresAt: at(10) }, now: NOW },
      fakeDeps(expired).deps),
    (error) => error.status === 409
  );
});

test('an empty edit is rejected', async () => {
  await assert.rejects(
    editAnnouncement({ user: ADMIN, announcementId: ID, body: {}, now: NOW }, fakeDeps(stored()).deps),
    (error) => error.status === 400
  );
});
