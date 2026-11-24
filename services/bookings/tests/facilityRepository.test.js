import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectFacilities,
  selectFacilityById,
  selectFacilityByIdForUpdate,
  selectOpeningHours
} from '../src/repositories/facilityRepository.js';

const facilityId = '55555555-5555-4555-8555-555555555555';

function fakeDb(query) {
  const fake = { calls: [] };

  fake.db = {
    async query(text, values) {
      fake.calls.push({ text, values });
      return query();
    }
  };

  return fake;
}

function facilityRow(name) {
  return {
    id: facilityId,
    name,
    description: '',
    locationDescription: 'Block A',
    status: 'ACTIVE',
    createdAt: new Date('2026-11-01T08:00:00Z'),
    updatedAt: new Date('2026-11-01T08:00:00Z')
  };
}

test('selectFacilities passes onlyActive true', async () => {
  const rows = [facilityRow('Gym'), facilityRow('Pool')];
  const fake = fakeDb(async () => ({ rows }));

  const result = await selectFacilities(fake.db, { onlyActive: true });

  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].values, [true]);
  assert.equal(fake.calls[0].text.includes('FROM bookings.facilities'), true);
  assert.equal(fake.calls[0].text.includes('ORDER BY name ASC, id ASC'), true);
  assert.equal(result, rows);
});

test('selectFacilities defaults to all facilities', async () => {
  const fake = fakeDb(async () => ({ rows: [] }));

  await selectFacilities(fake.db);
  await selectFacilities(fake.db, { onlyActive: false });
  await selectFacilities(fake.db, { onlyActive: 'yes' });

  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls[0].values, [false]);
  assert.deepEqual(fake.calls[1].values, [false]);
  assert.deepEqual(fake.calls[2].values, [false]);
});

test('selectFacilityById returns the row without locking', async () => {
  const row = facilityRow('Pool');
  const fake = fakeDb(async () => ({ rows: [row] }));

  const result = await selectFacilityById(fake.db, facilityId);

  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].values, [facilityId]);
  assert.equal(fake.calls[0].text.includes('WHERE id = $1::uuid'), true);
  assert.equal(fake.calls[0].text.includes('FOR UPDATE'), false);
  assert.equal(result, row);
});

test('selectFacilityById returns null when no row exists', async () => {
  const fake = fakeDb(async () => ({ rows: [] }));

  const result = await selectFacilityById(fake.db, facilityId);

  assert.equal(result, null);
});

test('selectFacilityByIdForUpdate locks the row', async () => {
  const row = facilityRow('Pool');
  const fake = fakeDb(async () => ({ rows: [row] }));

  const result = await selectFacilityByIdForUpdate(fake.db, facilityId);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text.includes('FOR UPDATE'), true);
  assert.equal(fake.calls[0].text.trim().endsWith('FOR UPDATE'), true);
  assert.deepEqual(fake.calls[0].values, [facilityId]);
  assert.equal(result, row);
});

test('selectFacilityByIdForUpdate returns null when no row exists', async () => {
  const fake = fakeDb(async () => ({ rows: [] }));

  const result = await selectFacilityByIdForUpdate(fake.db, facilityId);

  assert.equal(result, null);
});

test('selectOpeningHours reads the weekly schedule in day order', async () => {
  const rows = [
    { dayOfWeek: 0, opensAt: '08:00', closesAt: '22:00' },
    { dayOfWeek: 1, opensAt: '08:00', closesAt: '22:00' }
  ];
  const fake = fakeDb(async () => ({ rows }));

  const result = await selectOpeningHours(fake.db, facilityId);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text.includes('bookings.opening_hours'), true);
  assert.equal(fake.calls[0].text.includes("to_char(opens_at, 'HH24:MI')"), true);
  assert.equal(fake.calls[0].text.includes("to_char(closes_at, 'HH24:MI')"), true);
  assert.equal(fake.calls[0].text.includes('ORDER BY day_of_week ASC'), true);
  assert.deepEqual(fake.calls[0].values, [facilityId]);
  assert.equal(result, rows);
});

test('facility repository functions let database errors through unchanged', async () => {
  const calls = [
    (db) => selectFacilities(db, { onlyActive: true }),
    (db) => selectFacilityById(db, facilityId),
    (db) => selectFacilityByIdForUpdate(db, facilityId),
    (db) => selectOpeningHours(db, facilityId)
  ];

  for (const call of calls) {
    const original = new Error('connection lost');
    const fake = fakeDb(async () => {
      throw original;
    });

    await assert.rejects(call(fake.db), (error) => {
      assert.equal(error === original, true);
      return true;
    });
  }
});
