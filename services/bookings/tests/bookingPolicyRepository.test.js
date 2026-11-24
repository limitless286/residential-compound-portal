import assert from 'node:assert/strict';
import test from 'node:test';

import { selectBookingPolicy } from '../src/repositories/bookingPolicyRepository.js';

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

test('selectBookingPolicy returns the policy fields', async () => {
  const row = {
    maxFutureBookingsPerUnit: 2,
    advanceDays: 7,
    cancellationCutoffMinutes: 120,
    allowedDurationMinutes: [60, 120]
  };
  const fake = fakeDb(async () => ({ rows: [row] }));

  const result = await selectBookingPolicy(fake.db);

  assert.deepEqual(result, {
    maxFutureBookingsPerUnit: 2,
    advanceDays: 7,
    cancellationCutoffMinutes: 120,
    allowedDurationMinutes: [60, 120]
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.allowedDurationMinutes), true);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].text.includes('bookings.booking_policies'), true);
  assert.equal(fake.calls[0].text.includes('WHERE id = TRUE'), true);
  assert.equal(fake.calls[0].text.includes('FOR UPDATE'), false);
  assert.equal(fake.calls[0].values, undefined);
});

test('selectBookingPolicy throws when the row is missing', async () => {
  const fake = fakeDb(async () => ({ rows: [] }));

  await assert.rejects(selectBookingPolicy(fake.db), (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.message, 'The booking policy row is missing.');
    return true;
  });
});

test('selectBookingPolicy lets database errors through unchanged', async () => {
  const original = new Error('connection lost');
  const fake = fakeDb(async () => {
    throw original;
  });

  await assert.rejects(selectBookingPolicy(fake.db), (error) => {
    assert.equal(error === original, true);
    return true;
  });
});
