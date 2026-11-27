// In-memory stand-ins for the database used by MOCKED service tests.
// Transactions copy state and restore it on failure, mimicking ROLLBACK.
// They do not prove real PostgreSQL locking or constraint behavior.
export function createFakeStore() {
  const state = {
    records: new Map(),
    invoices: new Map()
  };

  const scopeKey = (scope) => [
    scope.callerService,
    scope.userId,
    scope.endpoint,
    scope.idempotencyKey
  ].join('|');

  const idempotency = {
    findRecord: async (scope) => state.records.get(scopeKey(scope)) ?? null,
    lockScope: async () => {},
    insertRecord: async (client, scope, record) => {
      if (state.records.has(scopeKey(scope))) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      state.records.set(scopeKey(scope), structuredClone(record));
    },
    transaction: async (work) => {
      const snapshot = {
        records: new Map(state.records),
        invoices: new Map(state.invoices)
      };

      try {
        return await work({ fake: true });
      } catch (error) {
        state.records = snapshot.records;
        state.invoices = snapshot.invoices;
        throw error;
      }
    }
  };

  async function insertInvoicesForUnits(client, invoice) {
    let created = 0;

    for (const unitId of invoice.unitIds) {
      const key = unitId + '|' + invoice.periodStart;

      if (!state.invoices.has(key)) {
        state.invoices.set(key, { ...invoice, unitId });
        created += 1;
      }
    }

    return created;
  }

  return { state, idempotency, insertInvoicesForUnits };
}
