// Unit tests: pure functions only. No database or network access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBillingPeriod,
  requireBody,
  requireIdempotencyKey,
  requireInteger,
  requireQuery,
  requireText,
  requireTimestamp,
  requireUuid
} from '../src/utils/validation.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function assertInvalid(fn, code = 'INVALID_INPUT') {
  assert.throws(fn, (error) => error.status === 400 && error.code === code);
}

function fakeRequest(headers) {
  return { get: (name) => headers[name] };
}

test('parseBillingPeriod accepts YYYY-MM and returns the first day', () => {
  assert.deepEqual(parseBillingPeriod('2026-12'), {
    billingPeriod: '2026-12',
    periodStart: '2026-12-01'
  });
});

test('parseBillingPeriod rejects malformed and out-of-range periods', () => {
  for (const value of ['2026-13', '2026-00', '2026-1', '202612', '1999-12',
    '2101-01', 202612, null, undefined]) {
    assertInvalid(() => parseBillingPeriod(value));
  }
});

test('requireTimestamp normalizes offsets to UTC', () => {
  assert.equal(
    requireTimestamp('2026-12-01T10:00:00+02:00', 'paidAt'),
    '2026-12-01T08:00:00.000Z'
  );
});

test('requireTimestamp rejects missing timezone and impossible dates', () => {
  for (const value of ['2026-12-01T10:00:00', '2026-12-01',
    '2026-02-30T10:00:00Z', 'yesterday', 1700000000000]) {
    assertInvalid(() => requireTimestamp(value, 'paidAt'));
  }
});

test('requireBody rejects unknown fields and non-objects', () => {
  assert.deepEqual(requireBody({ a: 1 }, ['a']), { a: 1 });
  assertInvalid(() => requireBody({ a: 1, role: 'ADMIN' }, ['a']));
  assertInvalid(() => requireBody([], ['a']));
  assertInvalid(() => requireBody(null, ['a']));
});

test('requireQuery rejects unknown and repeated parameters', () => {
  assert.deepEqual(requireQuery({ limit: '5' }, ['limit']), { limit: '5' });
  assertInvalid(() => requireQuery({ unitId: VALID_UUID }, ['limit']));
  assertInvalid(() => requireQuery({ limit: ['1', '2'] }, ['limit']));
});

test('requireInteger enforces safe integers within bounds', () => {
  assert.equal(requireInteger(500, 'amountMinor', { min: 1, max: 1000 }), 500);
  for (const value of [0, 1001, 1.5, '500', NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assertInvalid(() =>
      requireInteger(value, 'amountMinor', { min: 1, max: 1000 }));
  }
});

test('requireText trims and enforces length', () => {
  assert.equal(requireText('  Hello  ', 'title', { min: 3, max: 10 }), 'Hello');
  assertInvalid(() => requireText('   ab   ', 'title', { min: 3, max: 10 }));
  assertInvalid(() => requireText(42, 'title', { min: 3, max: 10 }));
});

test('requireUuid normalizes case and rejects invalid identifiers', () => {
  assert.equal(requireUuid(VALID_UUID.toUpperCase(), 'id'), VALID_UUID);
  assertInvalid(() => requireUuid('not-a-uuid', 'id'));
  assertInvalid(() => requireUuid(undefined, 'id'));
});

test('requireIdempotencyKey requires a UUID header', () => {
  assert.equal(
    requireIdempotencyKey(fakeRequest({ 'Idempotency-Key': VALID_UUID })),
    VALID_UUID
  );
  assertInvalid(
    () => requireIdempotencyKey(fakeRequest({})),
    'IDEMPOTENCY_KEY_REQUIRED'
  );
  assertInvalid(
    () => requireIdempotencyKey(fakeRequest({ 'Idempotency-Key': 'abc' })),
    'INVALID_IDEMPOTENCY_KEY'
  );
});
