import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteOpeningHours,
  insertFacility,
  insertOpeningHour,
  updateFacility
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

test('insertFacility sends the values in order and returns the row', async () => {
  const row = facilityRow('Pool');
  const fake = fakeDb(async () => ({ rows: [row], rowCount: 1 }));

  const result = await insertFacility(fake.db, {
    name: 'Pool',
    description: 'Outdoor pool',
    locationDescription: 'Block A'
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text.includes('INSERT INTO bookings.facilities'), true);
  assert.equal(fake.calls[0].text.includes('(name, description, location_description)'), true);
  assert.equal(fake.calls[0].text.includes('RETURNING'), true);
  assert.deepEqual(fake.calls[0].values, ['Pool', 'Outdoor pool', 'Block A']);
  assert.equal(result, row);
});

test('updateFacility sends given fields and null for the rest', async () => {
  const row = facilityRow('New name');
  const fake = fakeDb(async () => ({ rows: [row], rowCount: 1 }));

  const result = await updateFacility(fake.db, facilityId, { name: 'New name' });

  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].values, [facilityId, 'New name', null, null, null]);
  assert.equal(fake.calls[0].text.includes('UPDATE bookings.facilities'), true);
  assert.equal(fake.calls[0].text.includes('COALESCE($2, name)'), true);
  assert.equal(fake.calls[0].text.includes('updated_at = CURRENT_TIMESTAMP'), true);
  assert.equal(fake.calls[0].text.includes('WHERE id = $1::uuid'), true);
  assert.equal(fake.calls[0].text.includes('RETURNING'), true);
  assert.equal(result, row);
});

test('updateFacility keeps an empty description', async () => {
  const fake = fakeDb(async () => ({ rows: [facilityRow('Pool')], rowCount: 1 }));

  await updateFacility(fake.db, facilityId, { description: '' });

  assert.deepEqual(fake.calls[0].values, [facilityId, null, '', null, null]);
});

test('updateFacility with status only changes nothing else', async () => {
  const fake = fakeDb(async () => ({ rows: [facilityRow('Pool')], rowCount: 1 }));

  await updateFacility(fake.db, facilityId, { status: 'INACTIVE' });
  await updateFacility(fake.db, facilityId);

  assert.equal(fake.calls.length, 2);
  assert.deepEqual(fake.calls[0].values, [facilityId, null, null, null, 'INACTIVE']);
  assert.deepEqual(fake.calls[1].values, [facilityId, null, null, null, null]);
});

test('updateFacility returns null when no row exists', async () => {
  const fake = fakeDb(async () => ({ rows: [], rowCount: 0 }));

  const result = await updateFacility(fake.db, facilityId, { name: 'New name' });

  assert.equal(result, null);
});

test('deleteOpeningHours deletes by facility and returns the row count', async () => {
  const fake = fakeDb(async () => ({ rows: [], rowCount: 3 }));

  const result = await deleteOpeningHours(fake.db, facilityId);

  assert.equal(result, 3);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text.includes('DELETE FROM bookings.opening_hours'), true);
  assert.equal(fake.calls[0].text.includes('WHERE facility_id = $1::uuid'), true);
  assert.deepEqual(fake.calls[0].values, [facilityId]);
});

test('insertOpeningHour sends the four values in order', async () => {
  const fake = fakeDb(async () => ({ rows: [], rowCount: 1 }));

  const result = await insertOpeningHour(fake.db, {
    facilityId,
    dayOfWeek: 2,
    opensAt: '08:00',
    closesAt: '22:00'
  });

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text.includes('INSERT INTO bookings.opening_hours'), true);
  assert.equal(
    fake.calls[0].text.includes('(facility_id, day_of_week, opens_at, closes_at)'),
    true
  );
  assert.equal(fake.calls[0].text.includes('$3::time'), true);
  assert.equal(fake.calls[0].text.includes('$4::time'), true);
  assert.deepEqual(fake.calls[0].values, [facilityId, 2, '08:00', '22:00']);
  assert.equal(result, undefined);
});

test('facility write functions let database errors through unchanged', async () => {
  const calls = [
    (db) => insertFacility(db, { name: 'Pool', description: '', locationDescription: 'Block A' }),
    (db) => updateFacility(db, facilityId, { name: 'New name' }),
    (db) => deleteOpeningHours(db, facilityId),
    (db) => insertOpeningHour(db, { facilityId, dayOfWeek: 2, opensAt: '08:00', closesAt: '22:00' })
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
