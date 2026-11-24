import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readInteger,
  readText,
  readTimestamp,
  readUuid,
  rejectUnknownFields,
  requireJsonObject,
  validateLocalDate,
  validateUuid
} from '../src/utils/validation.js';

function rejects400(fn) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_INPUT');
    return true;
  });
}

test('requireJsonObject accepts objects only', () => {
  assert.deepEqual(requireJsonObject({ a: 1 }), { a: 1 });
  rejects400(() => requireJsonObject(undefined));
  rejects400(() => requireJsonObject(null));
  rejects400(() => requireJsonObject([]));
  rejects400(() => requireJsonObject('text'));
});

test('rejectUnknownFields rejects unsupported fields', () => {
  rejectUnknownFields({ name: 'x' }, ['name', 'description']);
  rejects400(() => rejectUnknownFields({ name: 'x', role: 'ADMIN' }, ['name']));
});

test('validateUuid normalizes and rejects bad ids', () => {
  const id = '33333333-3333-4333-8333-333333333333';
  assert.equal(validateUuid(id.toUpperCase()), id);
  rejects400(() => validateUuid('not-a-uuid'));
  rejects400(() => validateUuid(123));
  rejects400(() => validateUuid(undefined));
});

test('readUuid honours optional fields', () => {
  assert.equal(readUuid({}, 'facilityId', { optional: true }), null);
  assert.equal(readUuid({ facilityId: null }, 'facilityId', { optional: true }), null);
  rejects400(() => readUuid({}, 'facilityId'));
});

test('readText trims and enforces length', () => {
  assert.equal(readText({ name: '  Pool  ' }, 'name', { min: 1, max: 100 }), 'Pool');
  rejects400(() => readText({ name: '   ' }, 'name', { min: 1, max: 100 }));
  rejects400(() => readText({ name: 'a'.repeat(101) }, 'name', { min: 1, max: 100 }));
  rejects400(() => readText({ name: 5 }, 'name', { min: 1, max: 100 }));
  rejects400(() => readText({ name: 'a\u0000b' }, 'name', { min: 1, max: 100 }));
  assert.equal(readText({}, 'note', { max: 10, optional: true }), null);
});

test('readInteger accepts whole numbers in range only', () => {
  assert.equal(readInteger({ n: 60 }, 'n', { min: 1, max: 480 }), 60);
  rejects400(() => readInteger({ n: 60.5 }, 'n', { min: 1, max: 480 }));
  rejects400(() => readInteger({ n: '60' }, 'n', { min: 1, max: 480 }));
  rejects400(() => readInteger({ n: 0 }, 'n', { min: 1, max: 480 }));
});

test('readTimestamp requires a timezone and normalizes to UTC', () => {
  assert.equal(
    readTimestamp({ startAt: '2026-12-01T10:00:00+02:00' }, 'startAt'),
    '2026-12-01T08:00:00.000Z'
  );
  assert.equal(
    readTimestamp({ startAt: '2026-12-01T08:00:00Z' }, 'startAt'),
    '2026-12-01T08:00:00.000Z'
  );
  rejects400(() => readTimestamp({ startAt: '2026-12-01T08:00:00' }, 'startAt'));
  rejects400(() => readTimestamp({ startAt: '2026-12-01' }, 'startAt'));
  rejects400(() => readTimestamp({ startAt: '2026-02-31T08:00:00Z' }, 'startAt'));
  rejects400(() => readTimestamp({ startAt: 1790000000 }, 'startAt'));
  rejects400(() => readTimestamp({}, 'startAt'));
});

test('validateLocalDate checks the calendar', () => {
  assert.equal(validateLocalDate('2026-12-01'), '2026-12-01');
  assert.equal(validateLocalDate('2028-02-29'), '2028-02-29');
  rejects400(() => validateLocalDate('2026-02-29'));
  rejects400(() => validateLocalDate('2026-13-01'));
  rejects400(() => validateLocalDate('01-12-2026'));
  rejects400(() => validateLocalDate(undefined));
});

test('readTimestamp rejects impossible times', () => {
  rejects400(() => readTimestamp({ t: '2026-12-01T24:00:00Z' }, 't'));
  rejects400(() => readTimestamp({ t: '2026-12-01T10:60:00Z' }, 't'));
  rejects400(() => readTimestamp({ t: '2026-12-01T10:00:61Z' }, 't'));
  rejects400(() => readTimestamp({ t: '2026-12-01T10:00:00+25:00' }, 't'));
  rejects400(() => readTimestamp({ t: '2026-04-31T10:00:00Z' }, 't'));
});
