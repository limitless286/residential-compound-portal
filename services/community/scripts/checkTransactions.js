// REAL DATABASE check of withTransaction, run as community_app. Writes
// nothing: it uses pg_sleep, advisory locks and a session setting only.
// Run from services/community:
//
//   node --env-file=.env scripts/checkTransactions.js
//
// A private one-connection pool is used so each check can confirm whether
// the same connection came back to the pool afterwards, and in what state.
import pg from 'pg';
import { withTransaction } from '../src/config/database.js';

const FAST = { lockTimeoutMs: 500, statementTimeoutMs: 1000 };
let failures = 0;

function report(passed, name, detail = '') {
  if (!passed) failures += 1;
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
}

function makePool(max) {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({ connectionString: url.toString(), enableChannelBinding: true, max });
  pool.on('error', () => {});
  return pool;
}

async function expectCode(promise) {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error.code || 'UNKNOWN';
  }
}

// Advisory lock keys unique to this run, so parallel runs never collide.
const base = Math.floor(Math.random() * 1e12);
const KEY_A = base;
const KEY_B = base + 1;

const pool = makePool(1);
const other = makePool(2);

try {
  const who = await pool.query('SELECT current_user AS name, pg_backend_pid() AS pid');
  report(who.rows[0].name === 'community_app', 'connected as community_app', who.rows[0].name);
  const firstPid = who.rows[0].pid;

  console.log('\n== Timeouts are transaction-local');
  const inside = await withTransaction(async (client) => {
    const r = await client.query(
      "SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS stmt"
    );
    return r.rows[0];
  }, pool);
  report(inside.lock === '3s' && inside.stmt === '8s', 'defaults applied inside the transaction',
    `lock_timeout=${inside.lock}, statement_timeout=${inside.stmt}`);

  const after = await pool.query(
    "SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS stmt, pg_backend_pid() AS pid"
  );
  report(after.rows[0].lock !== '3s' && after.rows[0].stmt !== '8s',
    'settings do not leak to the next user of the connection',
    `lock_timeout=${after.rows[0].lock}, statement_timeout=${after.rows[0].stmt}`);

  console.log('\n== Statement timeout');
  let started = Date.now();
  const timeoutCode = await expectCode(withTransaction(async (client) => {
    await client.query("SELECT set_config('app.check_marker', 'dirty', false)");
    await client.query('SELECT pg_sleep(5)');
  }, pool, FAST));
  const elapsed = Date.now() - started;
  report(timeoutCode === '57014', 'a long statement is cancelled', 'got ' + timeoutCode);
  report(elapsed < 3000, 'cancelled near the 1s limit, not after 5s', elapsed + 'ms');

  const clean = await pool.query(
    "SELECT current_setting('app.check_marker', true) AS marker, pg_backend_pid() AS pid, " +
    "now() = statement_timestamp() AS fresh"
  );
  report(!clean.rows[0].marker, 'ROLLBACK ran: work inside the failed transaction was undone',
    'marker=' + JSON.stringify(clean.rows[0].marker));
  report(clean.rows[0].fresh, 'connection is no longer inside a transaction');
  report(clean.rows[0].pid === firstPid, 'healthy connection was returned to the pool and reused');

  console.log('\n== Lock timeout');
  const holder = await other.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock($1)', [KEY_A]);

    started = Date.now();
    const lockCode = await expectCode(withTransaction(
      (client) => client.query('SELECT pg_advisory_xact_lock($1)', [KEY_A]), pool, FAST));
    report(lockCode === '55P03', 'waiting on a held lock fails with lock timeout', 'got ' + lockCode);
    report(Date.now() - started < 3000, 'gave up near the 500ms limit', (Date.now() - started) + 'ms');
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }

  const lockFree = await expectCode(withTransaction(
    (client) => client.query('SELECT pg_advisory_xact_lock($1)', [KEY_A]), pool, FAST));
  report(lockFree === 'no error', 'the lock is available once the holder ends', lockFree);

  console.log('\n== Deadlock');
  const pause = (client) => client.query('SELECT pg_sleep(0.3)');
  const results = await Promise.allSettled([
    withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [KEY_A]);
      await pause(client);
      await client.query('SELECT pg_advisory_xact_lock($1)', [KEY_B]);
    }, other),
    withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [KEY_B]);
      await pause(client);
      await client.query('SELECT pg_advisory_xact_lock($1)', [KEY_A]);
    }, other)
  ]);
  const codes = results.map((r) => (r.status === 'fulfilled' ? 'ok' : r.reason.code));
  report(codes.filter((c) => c === '40P01').length === 1 && codes.includes('ok'),
    'one transaction is chosen as the deadlock victim, the other commits', codes.join(', '));
  report(other.idleCount === other.totalCount && other.waitingCount === 0,
    'both connections were released', `idle=${other.idleCount}, total=${other.totalCount}`);

  console.log('\n== Broken connection is discarded');
  const deadCode = await expectCode(withTransaction(
    (client) => client.query('SELECT pg_terminate_backend(pg_backend_pid())'), pool));
  report(deadCode !== 'no error', 'the work fails when its connection dies', 'got ' + deadCode);
  report(pool.totalCount === 0, 'the dead connection was destroyed, not returned', 'total=' + pool.totalCount);

  const fresh = await pool.query('SELECT pg_backend_pid() AS pid');
  report(fresh.rows[0].pid !== firstPid, 'the pool opens a new connection afterwards');
} catch (error) {
  console.error('Check aborted. Code:', error.code || 'UNKNOWN', '-', error.message);
  failures += 1;
} finally {
  await pool.end();
  await other.end();
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exitCode = failures === 0 ? 0 : 1;
