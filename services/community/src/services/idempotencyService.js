import { createHash } from 'node:crypto';
import { getDatabase, withTransaction } from '../config/database.js';
import {
  insertIdempotencyRecord,
  lockIdempotencyScope,
  selectIdempotencyRecord
} from '../repositories/idempotencyRepository.js';
import { httpError } from '../utils/httpError.js';

export const idempotencyStore = {
  findRecord: (scope, db = getDatabase()) =>
    selectIdempotencyRecord(db, scope),
  lockScope: lockIdempotencyScope,
  insertRecord: insertIdempotencyRecord,
  transaction: (work) => withTransaction(work)
};

// Fingerprint of the validated payload with keys in a stable order.
export function fingerprintPayload(payload) {
  const canonical = JSON.stringify(
    Object.keys(payload).sort().map((key) => [key, payload[key]])
  );

  return createHash('sha256').update(canonical).digest('hex');
}

function replayOrConflict(record, fingerprint) {
  if (record.fingerprint !== fingerprint) {
    throw httpError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'This Idempotency-Key was already used with a different request.'
    );
  }

  return { status: record.status, data: record.body, replayed: true };
}

/**
 * Runs a mutation at most once per idempotency scope.
 *
 * prepare() runs outside the transaction (for example, remote lookups).
 * perform(client, prepared) runs inside the transaction and its result is
 * recorded atomically with the mutation. Failures are never recorded, so a
 * retry after a transient failure runs the operation again.
 */
export async function executeIdempotent(
  { scope, payload, prepare = async () => undefined, perform },
  store = idempotencyStore
) {
  const fingerprint = fingerprintPayload(payload);
  const existing = await store.findRecord(scope);

  if (existing) {
    return replayOrConflict(existing, fingerprint);
  }

  const prepared = await prepare();

  return store.transaction(async (client) => {
    await store.lockScope(client, scope);

    const recorded = await store.findRecord(scope, client);

    if (recorded) {
      return replayOrConflict(recorded, fingerprint);
    }

    const { status, data } = await perform(client, prepared);

    await store.insertRecord(client, scope, {
      fingerprint,
      status,
      body: data
    });

    return { status, data, replayed: false };
  });
}
