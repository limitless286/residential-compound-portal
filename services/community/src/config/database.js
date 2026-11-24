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

export async function withTransaction(work, database = getDatabase()) {
  const client = await database.connect();
  let releaseError;

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
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
