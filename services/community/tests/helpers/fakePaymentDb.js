// In-memory MOCK of the payment tables for service tests.
// Models READ COMMITTED visibility (a transaction sees committed rows plus
// its own uncommitted rows) and a per-invoice row lock held until commit
// or rollback. It does not replace the real PostgreSQL locking check in
// scripts/checkPaymentLocking.js.
import { setTimeout as delay } from 'node:timers/promises';

function createMutexes() {
  const tails = new Map();

  return async function acquire(key) {
    const previous = tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    tails.set(key, previous.then(() => current));
    await previous;
    return release;
  };
}

export function createFakePaymentDb({ invoices, lockEnabled = true, readDelayMs = 5 }) {
  const committed = { payments: [], records: new Map() };
  const acquire = createMutexes();
  let nextId = 1;

  const scopeKey = (scope) => [
    scope.callerService, scope.userId, scope.endpoint, scope.idempotencyKey
  ].join('|');

  const visiblePayments = (client) =>
    client ? [...committed.payments, ...client.pendingPayments] : committed.payments;

  const idempotency = {
    findRecord: async (scope, client) =>
      client?.pendingRecords.get(scopeKey(scope)) ??
      committed.records.get(scopeKey(scope)) ?? null,
    lockScope: async (client, scope) => {
      client.releases.push(await acquire('scope:' + scopeKey(scope)));
    },
    insertRecord: async (client, scope, record) => {
      client.pendingRecords.set(scopeKey(scope), structuredClone(record));
    },
    transaction: async (work) => {
      const client = { pendingPayments: [], pendingRecords: new Map(), releases: [] };

      try {
        const result = await work(client);
        committed.payments.push(...client.pendingPayments);
        for (const [key, value] of client.pendingRecords) {
          committed.records.set(key, value);
        }
        return result;
      } finally {
        client.releases.forEach((release) => release());
      }
    }
  };

  const deps = {
    idempotency,

    lockInvoiceForPayment: async (client, invoiceId) => {
      const invoice = invoices[invoiceId];
      if (!invoice) return null;
      if (lockEnabled) {
        client.releases.push(await acquire('invoice:' + invoiceId));
      }
      return { id: invoiceId, unitId: invoice.unitId, amountMinor: invoice.amountMinor };
    },

    sumPaymentsForInvoice: async (client, invoiceId) => {
      const total = visiblePayments(client)
        .filter((payment) => payment.invoiceId === invoiceId)
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      // Widens the gap between reading the balance and inserting, so a
      // missing lock reliably produces a race.
      await delay(readDelayMs);
      return total;
    },

    paymentReferenceExists: async (client, reference) =>
      visiblePayments(client).some((p) => p.paymentReference === reference),

    insertPayment: async (client, payment) => {
      const saved = {
        id: 'payment-' + nextId++,
        invoiceId: payment.invoiceId,
        amountMinor: payment.amountMinor,
        paymentReference: payment.paymentReference,
        paymentMethod: payment.paymentMethod,
        paidAt: payment.paidAt,
        recordedBy: payment.recordedBy,
        createdAt: new Date().toISOString()
      };
      client.pendingPayments.push(saved);
      return saved;
    },

    selectInvoiceById: async (client, invoiceId) => {
      const invoice = invoices[invoiceId];
      const paid = visiblePayments(client)
        .filter((payment) => payment.invoiceId === invoiceId)
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      return {
        id: invoiceId,
        unitId: invoice.unitId,
        billingPeriod: '2026-11',
        amountMinor: invoice.amountMinor,
        paidAmountMinor: paid,
        remainingAmountMinor: invoice.amountMinor - paid,
        status: paid === 0 ? 'UNPAID' : paid < invoice.amountMinor ? 'PARTIALLY_PAID' : 'PAID',
        isOverdue: false
      };
    }
  };

  return { committed, deps };
}
