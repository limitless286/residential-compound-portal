import pg from 'pg';
import { logAction } from '../utils/logger.js';

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  '53300',
  '57P01',
  '57P02',
  '57P03'
]);

let pool = null;

// The pool is created on first use so modules can be imported in tests
// without a database connection.
export function getDatabase() {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing.');
  }

  const connectionUrl = new URL(process.env.DATABASE_URL);
  connectionUrl.searchParams.set('sslmode', 'verify-full');

  pool = new pg.Pool({
    connectionString: connectionUrl.toString(),
    enableChannelBinding: true,
    max: 5,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000
  });

  pool.on('error', (error) => {
    logAction({
      action: 'DATABASE_POOL',
      outcome: 'FAILED',
      level: 'error',
      code: error.code || 'UNKNOWN'
    });
  });

  return pool;
}

// Transaction-local limits. A request waits at most lockTimeoutMs for a row
// or advisory lock and at most statementTimeoutMs for any one statement,
// well inside the API Gateway request limit.
export const TRANSACTION_LIMITS = Object.freeze({
  lockTimeoutMs: 3000,
  statementTimeoutMs: 8000
});

const MAX_LIMIT_MS = 20000;

function checkLimit(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT_MS) {
    throw new Error(`${name} must be an integer between 1 and ${MAX_LIMIT_MS}.`);
  }
  return value + 'ms';
}

/**
 * Runs work(client) in one transaction on one connection.
 *
 * - lock_timeout and statement_timeout are set with set_config(..., true),
 *   so they last only for this transaction and never leak to the next user
 *   of the pooled connection.
 * - Any failure (including lock timeout 55P03, statement timeout 57014 and
 *   deadlock 40P01) rolls the whole transaction back and is rethrown.
 * - The connection is always released. If ROLLBACK fails, or the failure
 *   was a connection error, the connection is destroyed instead of being
 *   returned to the pool in an unknown state.
 */
export async function withTransaction(
  work,
  database = getDatabase(),
  limits = TRANSACTION_LIMITS
) {
  const lockTimeout = checkLimit(limits.lockTimeoutMs, 'lockTimeoutMs');
  const statementTimeout = checkLimit(limits.statementTimeoutMs, 'statementTimeoutMs');

  const client = await database.connect();
  let discard = false;

  // pg only listens for errors on idle clients. Without this, a connection
  // that dies while checked out (for example a FATAL from the server or
  // Neon's pooler) emits an unhandled 'error' event and crashes the process.
  const onConnectionError = (error) => {
    discard = true;
    logAction({
      action: 'DATABASE_CONNECTION',
      outcome: 'FAILED',
      level: 'error',
      code: error.code || 'UNKNOWN'
    });
  };
  client.on?.('error', onConnectionError);

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('lock_timeout', $1, true),
              set_config('statement_timeout', $2, true)`,
      [lockTimeout, statementTimeout]
    );
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      discard = true;
    }

    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discard = true;
      logAction({
        action: 'DATABASE_ROLLBACK',
        outcome: 'FAILED',
        level: 'error',
        code: rollbackError.code || 'UNKNOWN'
      });
    }

    throw error;
  } finally {
    client.off?.('error', onConnectionError);
    // release(true) destroys the connection; release() returns it.
    client.release(discard ? true : undefined);
  }
}

// Failures that are safe to retry: the transaction was rolled back, so
// nothing was written (including any idempotency record).
const RETRYABLE_ERRORS = {
  '55P03': { code: 'DATABASE_BUSY', message: 'The record is busy. Please retry.' },
  '57014': { code: 'DATABASE_TIMEOUT', message: 'The database took too long to respond. Please retry.' },
  '40P01': { code: 'DATABASE_CONFLICT', message: 'A conflicting update was in progress. Please retry.' },
  '40001': { code: 'DATABASE_CONFLICT', message: 'A conflicting update was in progress. Please retry.' }
};

export function retryableDatabaseError(error) {
  if (!error || typeof error !== 'object' || typeof error.code !== 'string') {
    return null;
  }

  return RETRYABLE_ERRORS[error.code] ?? null;
}

export function isDatabaseUnavailable(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (typeof error.code === 'string' &&
      (UNAVAILABLE_CODES.has(error.code) || error.code.startsWith('08'))) {
    return true;
  }

  return /timeout exceeded when trying to connect|connection terminated/i
    .test(error.message || '');
}
