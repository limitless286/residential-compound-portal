// MOCKED tests for invoice ownership rules. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInvoice, listInvoices } from '../src/services/invoiceQueryService.js';
import { validateFeePolicy } from '../src/services/feePolicyService.js';

const UNIT_OWN = '11111111-1111-4111-8111-111111111111';
const UNIT_OTHER = '22222222-2222-4222-8222-222222222222';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const RESIDENT = { id: 'r', role: 'RESIDENT', unitId: UNIT_OWN };
const ADMIN = { id: 'a', role: 'ADMIN', unitId: null };

function listDeps(captured) {
  return {
    selectInvoices: async (filters) => {
      captured.push(filters);
      return { invoices: [], hasMore: false };
    }
  };
}

test('residents are always limited to their own unit', async () => {
  const captured = [];
  await listInvoices({ user: RESIDENT, query: {} }, listDeps(captured));
  assert.equal(captured[0].unitId, UNIT_OWN);
});

test('residents cannot pass a unitId filter', async () => {
  await assert.rejects(
    listInvoices({ user: RESIDENT, query: { unitId: UNIT_OTHER } }, listDeps([])),
    (error) => error.status === 400
  );
});

test('a resident without a linked unit is forbidden', async () => {
  await assert.rejects(
    listInvoices({ user: { ...RESIDENT, unitId: null }, query: {} }, listDeps([])),
    (error) => error.status === 403
  );
});

test('admins may filter by unit, period, status and overdue state', async () => {
  const captured = [];
  await listInvoices({
    user: ADMIN,
    query: {
      unitId: UNIT_OTHER,
      billingPeriod: '2026-12',
      status: 'PARTIALLY_PAID',
      overdue: 'true',
      limit: '10'
    }
  }, listDeps(captured));

  assert.deepEqual(captured[0], {
    unitId: UNIT_OTHER,
    periodStart: '2026-12-01',
    status: 'PARTIALLY_PAID',
    overdue: true,
    limit: 10,
    offset: 0
  });
});

test('invalid filters are rejected', async () => {
  for (const query of [{ status: 'LATE' }, { overdue: 'yes' }, { limit: '0' },
    { limit: '101' }, { billingPeriod: '2026-13' }]) {
    await assert.rejects(
      listInvoices({ user: ADMIN, query }, listDeps([])),
      (error) => error.status === 400
    );
  }
});

test('reports nextOffset when more invoices exist', async () => {
  const result = await listInvoices({ user: ADMIN, query: { limit: '5' } }, {
    selectInvoices: async () => ({ invoices: [], hasMore: true })
  });
  assert.equal(result.nextOffset, 5);
});

function detailDeps(invoice) {
  return { selectInvoiceById: async () => invoice };
}

test('a resident can read an invoice for their own unit', async () => {
  const invoice = await getInvoice(
    { user: RESIDENT, invoiceId: INVOICE_ID },
    detailDeps({ id: INVOICE_ID, unitId: UNIT_OWN })
  );
  assert.equal(invoice.id, INVOICE_ID);
});

test('a resident cannot read another unit\'s invoice', async () => {
  await assert.rejects(
    getInvoice(
      { user: RESIDENT, invoiceId: INVOICE_ID },
      detailDeps({ id: INVOICE_ID, unitId: UNIT_OTHER })
    ),
    (error) => error.status === 403
  );
});

test('an admin can read any invoice', async () => {
  const invoice = await getInvoice(
    { user: ADMIN, invoiceId: INVOICE_ID },
    detailDeps({ id: INVOICE_ID, unitId: UNIT_OTHER })
  );
  assert.equal(invoice.unitId, UNIT_OTHER);
});

test('unknown and malformed invoice ids return 404 and 400', async () => {
  await assert.rejects(
    getInvoice({ user: ADMIN, invoiceId: INVOICE_ID }, detailDeps(null)),
    (error) => error.status === 404
  );
  await assert.rejects(
    getInvoice({ user: ADMIN, invoiceId: 'abc' }, detailDeps(null)),
    (error) => error.status === 400
  );
});

test('fee policy validation enforces amount, currency and due day', () => {
  assert.deepEqual(
    validateFeePolicy({ monthlyAmountMinor: 150000, dueDay: 10 }),
    { monthlyAmountMinor: 150000, currency: 'EGP', dueDay: 10 }
  );

  for (const body of [
    { monthlyAmountMinor: 0, dueDay: 10 },
    { monthlyAmountMinor: 1.5, dueDay: 10 },
    { monthlyAmountMinor: 150000, dueDay: 29 },
    { monthlyAmountMinor: 150000, dueDay: 10, currency: 'USD' },
    { monthlyAmountMinor: 150000 },
    { monthlyAmountMinor: 150000, dueDay: 10, updatedBy: 'x' }
  ]) {
    assert.throws(() => validateFeePolicy(body), (error) => error.status === 400);
  }
});
