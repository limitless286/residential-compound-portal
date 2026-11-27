// MOCKED tests for insertReadReceipt's statement sequence. The snapshot
// behaviour that makes two statements necessary is PostgreSQL's own and is
// exercised against real PostgreSQL in scripts/checkReadReceipts.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertReadReceipt } from '../src/repositories/announcementRepository.js';

const RECEIPT = {
  userId: '11111111-1111-4111-8111-111111111111',
  buildingId: '22222222-2222-4222-8222-222222222222',
  announcementId: '33333333-3333-4333-8333-333333333333'
};
const READ_AT = new Date('2026-11-27T10:00:00.000Z');

function fakeDb(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = responses.shift();
      if (!next) throw new Error('unexpected query');
      return next;
    }
  };
}

test('a first read inserts and returns the new readAt in one statement', async () => {
  const db = fakeDb([{ rows: [{ eligibleCount: 1, insertedAt: READ_AT }] }]);

  const result = await insertReadReceipt(db, RECEIPT);

  assert.deepEqual(result, { eligible: true, readAt: READ_AT, firstRead: true });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /ON CONFLICT \(announcement_id, user_id\) DO NOTHING/);
});

test('a conflicting read is looked up in a separate statement and returns the stored readAt', async () => {
  // Statement 1 lost the race: eligible, nothing inserted (its snapshot
  // cannot see the winner's row). Statement 2 sees the committed row.
  const db = fakeDb([
    { rows: [{ eligibleCount: 1, insertedAt: null }] },
    { rowCount: 1, rows: [{ readAt: READ_AT }] }
  ]);

  const result = await insertReadReceipt(db, RECEIPT);

  assert.deepEqual(result, { eligible: true, readAt: READ_AT, firstRead: false });
  assert.equal(db.calls.length, 2, 'two separate statements');
  assert.doesNotMatch(db.calls[0].sql, /existingAt/, 'no same-snapshot lookup in statement 1');
  assert.doesNotMatch(db.calls[1].sql, /INSERT|UPDATE|DELETE/i, 'lookup never modifies the receipt');
  assert.deepEqual(db.calls[1].params, [RECEIPT.userId, RECEIPT.announcementId]);
});

test('an ineligible announcement returns not eligible without a lookup', async () => {
  const db = fakeDb([{ rows: [{ eligibleCount: 0, insertedAt: null }] }]);

  const result = await insertReadReceipt(db, RECEIPT);

  assert.deepEqual(result, { eligible: false, readAt: null, firstRead: false });
  assert.equal(db.calls.length, 1);
});

test('a conflict whose row cannot be read back fails instead of returning a null readAt', async () => {
  const db = fakeDb([
    { rows: [{ eligibleCount: 1, insertedAt: null }] },
    { rowCount: 0, rows: [] }
  ]);

  await assert.rejects(insertReadReceipt(db, RECEIPT), /could not be read back/);
});
