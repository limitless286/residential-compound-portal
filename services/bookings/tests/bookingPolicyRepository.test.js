import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectBookingPolicy,
  updateBookingPolicy
} from '../src/repositories/bookingPolicyRepository.js';

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

function policyInput() {
  return {
    maxFutureBookingsPerUnit: 3,
    advanceDays: 14,
    cancellationCutoffMinutes: 60,
    allowedDurationMinutes: [30, 60, 90]
  };
}

function policyRow() {
  return {
    maxFutureBookingsPerUnit: 3,
    advanceDays: 14,
    cancellationCutoffMinutes: 60,
    allowedDurationMinutes: [30, 60, 90]
  };
}

test('updateBookingPolicy sends one update statement on the policy table only', async () => {
  const fake = fakeDb(async () => ({ rows: [policyRow()] }));

  await updateBookingPolicy(fake.db, policyInput());

  assert.equal(fake.calls.length, 1);
  const text = fake.calls[0].text;
  assert.equal(text.trim().startsWith('UPDATE bookings.booking_policies'), true);
  assert.equal(text.includes('WHERE id = TRUE'), true);
  assert.equal(text.includes('RETURNING'), true);
  assert.equal(text.includes('updated_at = CURRENT_TIMESTAMP'), true);
  assert.equal(text.includes('$4::integer[]'), true);
  assert.deepEqual(text.match(/bookings\.\w+/g), ['bookings.booking_policies']);
  assert.equal(/\b(FROM|JOIN)\b/.test(text), false);
});

test('updateBookingPolicy sends the values in column order', async () => {
  const fake = fakeDb(async () => ({ rows: [policyRow()] }));

  await updateBookingPolicy(fake.db, policyInput());

  assert.deepEqual(fake.calls[0].values, [3, 14, 60, [30, 60, 90]]);
});

test('updateBookingPolicy returns a frozen copy and leaves the input alone', async () => {
  const row = policyRow();
  const input = policyInput();
  const fake = fakeDb(async () => ({ rows: [row] }));

  const result = await updateBookingPolicy(fake.db, input);

  assert.deepEqual(result, policyRow());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.allowedDurationMinutes), true);
  assert.notEqual(result.allowedDurationMinutes, row.allowedDurationMinutes);
  assert.equal(Object.isFrozen(input.allowedDurationMinutes), false);
  assert.deepEqual(input, policyInput());
});

test('updateBookingPolicy throws when the row is missing', async () => {
  const fake = fakeDb(async () => ({ rows: [] }));

  await assert.rejects(updateBookingPolicy(fake.db, policyInput()), (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.message, 'The booking policy row is missing.');
    return true;
  });
});

test('updateBookingPolicy lets database errors through unchanged', async () => {
  const original = new Error('connection lost');
  const fake = fakeDb(async () => {
    throw original;
  });

  await assert.rejects(updateBookingPolicy(fake.db, policyInput()), (error) => {
    assert.equal(error === original, true);
    return true;
  });
});

test('updateBookingPolicy never controls the transaction', async () => {
  const fake = fakeDb(async () => ({ rows: [policyRow()] }));

  await updateBookingPolicy(fake.db, policyInput());

  for (const call of fake.calls) {
    assert.equal(/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(call.text.trim()), false);
  }
});
