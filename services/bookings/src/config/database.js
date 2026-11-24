import pg from 'pg';

import { httpError } from '../utils/httpError.js';

const LOCK_TIMEOUT_MS = 5000;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing.');
}

const connectionUrl = new URL(process.env.DATABASE_URL);
connectionUrl.searchParams.set('sslmode', 'verify-full');

export const database = new pg.Pool({
  connectionString: connectionUrl.toString(),
  enableChannelBinding: true,
  max: 5,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000
});

database.on('error', (error) => {
  console.error('Database pool error:', error.code || 'UNKNOWN');
});

// SQLSTATE codes that mean "try again later": lock_not_available
// (lock_timeout expired) and deadlock_detected.
const BUSY_ERROR_CODES = new Set(['55P03', '40P01']);

// Runs work(client) inside one transaction with a transaction-local
// lock_timeout. Commits when it succeeds, rolls back when it throws, maps
// lock-timeout and deadlock errors to 503 SERVICE_BUSY, and always
// releases the connection.
export async function withTransaction(work) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('lock_timeout', $1, true)", [
      `${LOCK_TIMEOUT_MS}ms`
    ]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (BUSY_ERROR_CODES.has(error?.code)) {
      throw httpError(503, 'SERVICE_BUSY', 'The service is busy. Please try again.');
    }

    throw error;
  } finally {
    client.release();
  }
}
