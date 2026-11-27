// MOCKED service tests for offline payment recording (fakePaymentDb).
// Real PostgreSQL locking and privileges are verified separately by
// scripts/checkPaymentLocking.js after migration 006 is executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPayment, validatePayment } from '../src/services/paymentService.js';
import { createFakePaymentDb } from './helpers/fakePaymentDb.js';

const ADMIN = { id: '99999999-9999-4999-8999-999999999999', role: 'ADMIN' };
const INVOICE = '44444444-4444-4444-8444-444444444444';
const MISSING = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-24T12:00:00Z');
let keyCounter = 0;

function newKey() {
  keyCounter += 1;
  return '00000000-0000-4000-8000-' + String(keyCounter).padStart(12, '0');
}

function setup(options = {}) {
  return createFakePaymentDb({
    invoices: { [INVOICE]: { unitId: 'unit-1', amountMinor: 100000 } },
    ...options
  });
}

function body(overrides = {}) {
  return {
    invoiceId: INVOICE,
    amountMinor: 40000,
    paymentReference: 'REF-' + newKey().slice(-6),
    paymentMethod: 'CASH',
    paidAt: '2026-11-20T10:00:00+02:00',
    ...overrides
  };
}

function pay(deps, paymentBody, key = newKey()) {
  return recordPayment({
    user: ADMIN,
    idempotencyKey: key,
    body: paymentBody,
    requestId: 'req',
    now: NOW
  }, deps);
}

test('records a partial payment and derives the remaining balance', async () => {
  const { deps } = setup();
  const result = await pay(deps, body({ amountMinor: 40000 }));

  assert.equal(result.status, 201);
  assert.equal(result.data.payment.amountMinor, 40000);
  assert.equal(result.data.payment.paidAt, '2026-11-20T08:00:00.000Z');
  assert.equal(result.data.invoice.paidAmountMinor, 40000);
  assert.equal(result.data.invoice.remainingAmountMinor, 60000);
  assert.equal(result.data.invoice.status, 'PARTIALLY_PAID');
});

test('several partial payments can settle the invoice exactly', async () => {
  const { deps } = setup();
  await pay(deps, body({ amountMinor: 40000 }));
  const last = await pay(deps, body({ amountMinor: 60000 }));

  assert.equal(last.data.invoice.status, 'PAID');
  assert.equal(last.data.invoice.remainingAmountMinor, 0);
});

test('rejects a payment larger than the remaining balance', async () => {
  const { deps, committed } = setup();
  await pay(deps, body({ amountMinor: 70000 }));

  await assert.rejects(
    pay(deps, body({ amountMinor: 30001 })),
    (error) => error.status === 409 && error.code === 'OVERPAYMENT'
  );
  assert.equal(committed.payments.length, 1);
});

test('rejects any payment on a fully paid invoice', async () => {
  const { deps } = setup();
  await pay(deps, body({ amountMinor: 100000 }));

  await assert.rejects(
    pay(deps, body({ amountMinor: 1 })),
    (error) => error.status === 409 && error.code === 'INVOICE_ALREADY_PAID'
  );
});

test('rejects a duplicate payment reference under a new key', async () => {
  const { deps } = setup();
  await pay(deps, body({ paymentReference: 'BANK-777' }));

  await assert.rejects(
    pay(deps, body({ paymentReference: 'BANK-777' })),
    (error) => error.status === 409 && error.code === 'DUPLICATE_PAYMENT_REFERENCE'
  );
});

test('an identical retry replays the payment without a second insert', async () => {
  const { deps, committed } = setup();
  const key = newKey();
  const paymentBody = body();
  const first = await pay(deps, paymentBody, key);
  const retry = await pay(deps, paymentBody, key);

  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.data, first.data);
  assert.equal(committed.payments.length, 1);
});

test('reusing a key with a different payload returns 409', async () => {
  const { deps } = setup();
  const key = newKey();
  await pay(deps, body({ amountMinor: 1000 }), key);

  await assert.rejects(
    pay(deps, body({ amountMinor: 2000 }), key),
    (error) => error.status === 409 && error.code === 'IDEMPOTENCY_CONFLICT'
  );
});

test('an unknown invoice returns 404 and records nothing', async () => {
  const { deps, committed } = setup();

  await assert.rejects(
    pay(deps, body({ invoiceId: MISSING })),
    (error) => error.status === 404
  );
  assert.equal(committed.records.size, 0);
});

test('concurrent payments cannot together exceed the invoice amount', async () => {
  const { deps, committed } = setup();

  // Five admins each try to pay 30000 on a 100000 invoice at once.
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => pay(deps, body({ amountMinor: 30000 })))
  );

  const accepted = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  const total = committed.payments.reduce((sum, p) => sum + p.amountMinor, 0);

  assert.equal(accepted.length, 3);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every((r) => r.reason.code === 'OVERPAYMENT'));
  assert.equal(total, 90000);
});

test('control: without the invoice lock the same race overpays', async () => {
  const { deps, committed } = setup({ lockEnabled: false });

  await Promise.allSettled(
    Array.from({ length: 5 }, () => pay(deps, body({ amountMinor: 30000 })))
  );

  const total = committed.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  assert.ok(total > 100000, 'the race is real when the lock is missing');
});

test('concurrent identical retries create exactly one payment', async () => {
  const { deps, committed } = setup();
  const key = newKey();
  const paymentBody = body();

  const results = await Promise.all(
    Array.from({ length: 4 }, () => pay(deps, paymentBody, key))
  );

  assert.equal(committed.payments.length, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
});

test('payment validation rejects bad input', () => {
  const bad = [
    body({ amountMinor: 0 }),
    body({ amountMinor: -5 }),
    body({ amountMinor: 10.5 }),
    body({ paymentMethod: 'CARD' }),
    body({ paymentReference: '   ' }),
    body({ paymentReference: 'x'.repeat(101) }),
    body({ paidAt: '2026-11-20' }),
    body({ paidAt: '2026-12-24T12:00:00Z' }),
    body({ invoiceId: 'nope' }),
    { ...body(), recordedBy: ADMIN.id },
    { ...body(), cardNumber: '4111111111111111' }
  ];

  for (const paymentBody of bad) {
    assert.throws(
      () => validatePayment(paymentBody, NOW),
      (error) => error.status === 400,
      JSON.stringify(paymentBody)
    );
  }
});
