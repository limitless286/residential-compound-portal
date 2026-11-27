// MOCKED tests for transaction handling. A fake pool records every query and
// how the connection was released; no PostgreSQL is involved. The same
// failure modes are exercised against real PostgreSQL in
// scripts/checkTransactions.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  retryableDatabaseError,
  TRANSACTION_LIMITS,
  withTransaction
} from '../src/config/database.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

function pgError(code, message = 'pg error ' + code) {
  return Object.assign(new Error(message), { code });
}

// failOn: { BEGIN | COMMIT | ROLLBACK: error } makes that statement fail.
function fakePool(failOn = {}) {
  const state = { queries: [], releases: [], connects: 0 };

  // An EventEmitter like pg.Client, with no 'error' listener of its own:
  // an unhandled 'error' event throws, as it does in pg.
  const client = Object.assign(new EventEmitter(), {
    async query(sql, params) {
      const text = sql.trim().split(/\s+/)[0].toUpperCase();
      state.queries.push({ text, sql, params });
      if (failOn[text]) throw failOn[text];
      return { rows: [], rowCount: 0 };
    },
    release(destroy) {
      state.releases.push(destroy);
    }
  });

  return {
    state,
    client,
    async connect() {
      state.connects += 1;
      return client;
    }
  };
}

test('a successful transaction sets transaction-local timeouts and commits', async () => {
  const pool = fakePool();
  const result = await withTransaction(async (client) => {
    await client.query('SELECT 1');
    return 'done';
  }, pool);

  assert.equal(result, 'done');
  assert.deepEqual(pool.state.queries.map((q) => q.text), ['BEGIN', 'SELECT', 'SELECT', 'COMMIT']);

  const timeouts = pool.state.queries[1];
  assert.match(timeouts.sql, /set_config\('lock_timeout', \$1, true\)/);
  assert.match(timeouts.sql, /set_config\('statement_timeout', \$2, true\)/);
  assert.deepEqual(timeouts.params, [
    TRANSACTION_LIMITS.lockTimeoutMs + 'ms',
    TRANSACTION_LIMITS.statementTimeoutMs + 'ms'
  ]);
  assert.deepEqual(pool.state.releases, [undefined], 'connection returned to the pool');
});

for (const [code, label] of [['55P03', 'lock timeout'], ['57014', 'statement timeout'], ['40P01', 'deadlock']]) {
  test(`a ${label} rolls back, rethrows and returns the healthy connection`, async () => {
    const pool = fakePool();
    const failure = pgError(code);

    await assert.rejects(
      withTransaction(async () => { throw failure; }, pool),
      (error) => error === failure
    );

    assert.deepEqual(pool.state.queries.map((q) => q.text), ['BEGIN', 'SELECT', 'ROLLBACK']);
    assert.ok(!pool.state.queries.some((q) => q.text === 'COMMIT'), 'never commits');
    assert.deepEqual(pool.state.releases, [undefined]);
  });
}

test('a failed ROLLBACK destroys the connection and keeps the original error', async () => {
  const pool = fakePool({ ROLLBACK: pgError('08006', 'connection failure') });
  const failure = pgError('57014');

  await assert.rejects(
    withTransaction(async () => { throw failure; }, pool),
    (error) => error === failure
  );

  assert.deepEqual(pool.state.releases, [true], 'connection discarded');
});

test('a connection error discards the connection even if ROLLBACK succeeds', async () => {
  const pool = fakePool();

  await assert.rejects(
    withTransaction(async () => { throw pgError('ECONNRESET'); }, pool),
    (error) => error.code === 'ECONNRESET'
  );

  assert.deepEqual(pool.state.releases, [true]);
});

test('a connection error event during the transaction is handled and the connection discarded', async () => {
  const pool = fakePool();
  const failure = pgError('08P01', 'server conn crashed?');

  await assert.rejects(
    withTransaction(async (client) => {
      // pg emits the FATAL as an event, then the pending query rejects.
      client.emit('error', failure);
      throw failure;
    }, pool),
    (error) => error === failure
  );

  assert.deepEqual(pool.state.releases, [true]);
  assert.equal(pool.client.listenerCount('error'), 0, 'listener removed after release');
});

test('the error listener is removed after a successful transaction', async () => {
  const pool = fakePool();
  await withTransaction(async () => 'ok', pool);
  assert.equal(pool.client.listenerCount('error'), 0);
  assert.deepEqual(pool.state.releases, [undefined]);
});

test('a failed COMMIT rolls back and releases exactly once', async () => {
  const pool = fakePool({ COMMIT: pgError('40001') });

  await assert.rejects(withTransaction(async () => 'x', pool), (error) => error.code === '40001');

  assert.deepEqual(pool.state.queries.map((q) => q.text), ['BEGIN', 'SELECT', 'COMMIT', 'ROLLBACK']);
  assert.equal(pool.state.releases.length, 1);
});

test('a failed BEGIN still releases the connection and never runs the work', async () => {
  const pool = fakePool({ BEGIN: pgError('57P01') });
  let ran = false;

  await assert.rejects(withTransaction(async () => { ran = true; }, pool));

  assert.equal(ran, false);
  assert.deepEqual(pool.state.releases, [true], '57P01 is a connection error: discarded');
});

test('out-of-range limits are rejected before a connection is taken', async () => {
  for (const limits of [
    { lockTimeoutMs: 0, statementTimeoutMs: 1000 },
    { lockTimeoutMs: 1000, statementTimeoutMs: 60000 },
    { lockTimeoutMs: '1000', statementTimeoutMs: 1000 },
    { lockTimeoutMs: 1.5, statementTimeoutMs: 1000 }
  ]) {
    const pool = fakePool();
    await assert.rejects(withTransaction(async () => {}, pool, limits));
    assert.equal(pool.state.connects, 0);
  }
});

test('retryable database errors map to safe codes, others do not', () => {
  assert.equal(retryableDatabaseError(pgError('55P03')).code, 'DATABASE_BUSY');
  assert.equal(retryableDatabaseError(pgError('57014')).code, 'DATABASE_TIMEOUT');
  assert.equal(retryableDatabaseError(pgError('40P01')).code, 'DATABASE_CONFLICT');
  assert.equal(retryableDatabaseError(pgError('40001')).code, 'DATABASE_CONFLICT');
  assert.equal(retryableDatabaseError(pgError('23505')), null);
  assert.equal(retryableDatabaseError(new Error('plain')), null);
  assert.equal(retryableDatabaseError(null), null);
});

function fakeResponse() {
  const res = {
    headersSent: false,
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; }
  };
  return res;
}

for (const [code, expected] of [['55P03', 'DATABASE_BUSY'], ['57014', 'DATABASE_TIMEOUT'], ['40P01', 'DATABASE_CONFLICT']]) {
  test(`the error handler answers ${code} with 503 ${expected} and Retry-After`, () => {
    const res = fakeResponse();
    const internal = pgError(code, 'canceling statement due to lock timeout on "community"."invoices"');

    errorHandler(internal, { requestId: 'r1', method: 'POST', path: '/x' }, res, () => {});

    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['Retry-After'], '1');
    assert.equal(res.body.error.code, expected);
    assert.ok(!res.body.error.message.includes('community'), 'database detail not leaked');
    assert.equal(res.body.requestId, 'r1');
  });
}
