// MOCKED service tests: in-memory store and fake identity lookup.
// Real PostgreSQL constraints and locking are covered separately by the
// database integration check once migration 006 has been executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  cairoBillingPeriod,
  generateInvoices
} from '../src/services/invoiceGenerationService.js';
import { createFakeStore } from './helpers/fakeStore.js';

const ADMIN = { id: '99999999-9999-4999-8999-999999999999', role: 'ADMIN' };
const KEY_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNITS = [
  { unitId: '11111111-1111-4111-8111-111111111111' },
  { unitId: '22222222-2222-4222-8222-222222222222' }
];
const NOW = new Date('2026-11-24T12:00:00Z');
const POLICY = { monthlyAmountMinor: 150000, currency: 'EGP', dueDay: 10 };

function setup({ policy = POLICY, units = UNITS, identityError } = {}) {
  const store = createFakeStore();
  const identityCalls = [];

  const deps = {
    selectFeePolicy: async () => policy,
    fetchAllActiveUnits: async (input) => {
      identityCalls.push(input);
      if (identityError) throw identityError;
      return units;
    },
    insertInvoicesForUnits: store.insertInvoicesForUnits,
    idempotency: store.idempotency
  };

  return { store, deps, identityCalls };
}

function run(deps, { key = KEY_1, body = { billingPeriod: '2026-12' } } = {}) {
  return generateInvoices({
    user: ADMIN,
    authorization: 'Bearer token',
    idempotencyKey: key,
    body,
    requestId: 'req',
    now: NOW
  }, deps);
}

test('creates one invoice per active unit with the policy snapshot', async () => {
  const { store, deps } = setup();
  const result = await run(deps);

  assert.equal(result.status, 201);
  assert.equal(result.replayed, false);
  assert.deepEqual(result.data, {
    billingPeriod: '2026-12',
    monthlyAmountMinor: 150000,
    currency: 'EGP',
    dueDate: '2026-12-10',
    activeUnitCount: 2,
    createdCount: 2,
    skippedCount: 0
  });
  assert.equal(store.state.invoices.size, 2);
});

test('an identical retry replays the result without new work', async () => {
  const { store, deps, identityCalls } = setup();
  const first = await run(deps);
  const second = await run(deps);

  assert.equal(second.replayed, true);
  assert.deepEqual(second.data, first.data);
  assert.equal(identityCalls.length, 1);
  assert.equal(store.state.invoices.size, 2);
});

test('reusing a key with a different payload returns 409', async () => {
  const { deps } = setup();
  await run(deps);

  await assert.rejects(
    run(deps, { body: { billingPeriod: '2026-11' } }),
    (error) => error.status === 409 && error.code === 'IDEMPOTENCY_CONFLICT'
  );
});

test('a new key for the same period skips existing invoices', async () => {
  const { store, deps } = setup();
  await run(deps);
  const second = await run(deps, { key: KEY_2 });

  assert.equal(second.data.createdCount, 0);
  assert.equal(second.data.skippedCount, 2);
  assert.equal(store.state.invoices.size, 2);
});

test('identity failure creates nothing and records nothing', async () => {
  const failure = Object.assign(new Error('down'), {
    status: 503,
    code: 'IDENTITY_UNAVAILABLE'
  });
  const { store, deps } = setup({ identityError: failure });

  await assert.rejects(run(deps), (error) => error.status === 503);
  assert.equal(store.state.invoices.size, 0);
  assert.equal(store.state.records.size, 0);
});

test('a retry after a transient failure runs the operation again', async () => {
  const { store, deps } = setup();
  let failNext = true;
  const realInsert = deps.insertInvoicesForUnits;
  deps.insertInvoicesForUnits = async (...args) => {
    await realInsert(...args);
    if (failNext) {
      failNext = false;
      throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' });
    }
    return args[1].unitIds.length;
  };

  await assert.rejects(run(deps));
  assert.equal(store.state.invoices.size, 0, 'failed transaction rolled back');
  assert.equal(store.state.records.size, 0, 'failure was not recorded');

  const retry = await run(deps);
  assert.equal(retry.replayed, false);
  assert.equal(store.state.invoices.size, 2);
});

test('generation requires a configured fee policy', async () => {
  const { deps, identityCalls } = setup({ policy: null });

  await assert.rejects(
    run(deps),
    (error) => error.status === 409 && error.code === 'FEE_POLICY_REQUIRED'
  );
  assert.equal(identityCalls.length, 0);
});

test('rejects periods more than one month ahead of Cairo time', async () => {
  const { deps } = setup();

  await assert.rejects(
    run(deps, { body: { billingPeriod: '2027-01' } }),
    (error) => error.status === 400
  );
});

test('rejects unknown body fields such as a client-supplied unitId', async () => {
  const { deps } = setup();

  await assert.rejects(
    run(deps, { body: { billingPeriod: '2026-12', unitId: UNITS[0].unitId } }),
    (error) => error.status === 400
  );
});

test('no active units produces an empty successful generation', async () => {
  const { deps } = setup({ units: [] });
  const result = await run(deps);

  assert.equal(result.data.activeUnitCount, 0);
  assert.equal(result.data.createdCount, 0);
});

test('Cairo month and month arithmetic handle year boundaries', () => {
  assert.equal(cairoBillingPeriod(new Date('2026-12-31T22:30:00Z')), '2027-01');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
});
