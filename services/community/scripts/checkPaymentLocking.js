// REAL DATABASE integration check for invoice locking, run as community_app.
// Requires migration 006. Run from services/community:
//
//   node --env-file=.env scripts/checkPaymentLocking.js
//     Part A: privilege checks. Part B: two-connection lock check on an
//     existing invoice. Everything is rolled back; nothing is written.
//
//   node --env-file=.env scripts/checkPaymentLocking.js \
//     --invoice <invoiceId> --admin <adminUserId> --confirm-writes
//     Part C: concurrent payments through the real payment service.
//     This PERMANENTLY records payments (community_app cannot delete them).
//     Use only a dedicated test invoice agreed with the team.
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { getDatabase } from '../src/config/database.js';
import { recordPayment } from '../src/services/paymentService.js';

const { values: args } = parseArgs({
  options: {
    invoice: { type: 'string' },
    admin: { type: 'string' },
    'confirm-writes': { type: 'boolean', default: false }
  }
});

const db = getDatabase();
let failures = 0;

function report(passed, name, detail = '') {
  if (!passed) failures += 1;
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
}

async function expectError(client, name, sql, expectedCode) {
  await client.query('SAVEPOINT check_point');
  try {
    await client.query(sql);
    report(false, name, 'statement was allowed');
  } catch (error) {
    report(error.code === expectedCode, name, 'got ' + error.code);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT check_point');
  }
}

async function partA() {
  console.log('\n== Part A: privileges (rolled back)');
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const user = await client.query('SELECT current_user AS name');
    report(user.rows[0].name === 'community_app', 'connected as community_app', user.rows[0].name);

    const columns = await client.query(
      `SELECT column_name AS name,
              has_column_privilege(current_user, 'community.invoices', column_name, 'UPDATE') AS "canUpdate"
       FROM information_schema.columns
       WHERE table_schema = 'community' AND table_name = 'invoices'
       ORDER BY ordinal_position`
    );

    report(columns.rows.some((column) => column.name === 'lock_version'),
      'invoices.lock_version exists (migration 006)');

    for (const column of columns.rows) {
      const expected = column.name === 'lock_version';
      report(column.canUpdate === expected,
        'UPDATE on invoices.' + column.name + ' is ' + (expected ? 'granted' : 'forbidden'));
    }

    const table = await client.query(
      `SELECT has_table_privilege(current_user, 'community.invoices', 'UPDATE') AS "update",
              has_table_privilege(current_user, 'community.invoices', 'DELETE') AS "delete",
              has_table_privilege(current_user, 'community.payments', 'UPDATE') AS "paymentUpdate",
              has_table_privilege(current_user, 'community.payments', 'DELETE') AS "paymentDelete"`
    );
    const t = table.rows[0];
    report(!t.update, 'no table-wide UPDATE on invoices');
    report(!t.delete, 'no DELETE on invoices');
    report(!t.paymentUpdate && !t.paymentDelete, 'no UPDATE or DELETE on payments');

    for (const column of ['amount_minor', 'unit_id', 'billing_period', 'due_date', 'id', 'currency']) {
      await expectError(client, 'UPDATE invoices.' + column + ' is rejected',
        `UPDATE community.invoices SET ${column} = ${column} WHERE FALSE`, '42501');
    }

    await client.query('SAVEPOINT lock_check');
    try {
      await client.query('SELECT id FROM community.invoices WHERE id = gen_random_uuid() FOR UPDATE');
      report(true, 'SELECT ... FOR UPDATE on invoices is allowed');
    } catch (error) {
      report(false, 'SELECT ... FOR UPDATE on invoices is allowed', error.code);
      await client.query('ROLLBACK TO SAVEPOINT lock_check');
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function partB() {
  console.log('\n== Part B: two connections, one invoice row (rolled back)');
  const existing = await db.query('SELECT id FROM community.invoices ORDER BY created_at LIMIT 1');

  if (existing.rowCount === 0) {
    console.log('SKIP no invoice exists yet; generate one and rerun');
    return;
  }

  const invoiceId = existing.rows[0].id;
  const holder = await db.connect();
  const waiter = await db.connect();

  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM community.invoices WHERE id = $1 FOR UPDATE', [invoiceId]);

    await waiter.query('BEGIN');
    await waiter.query("SET LOCAL lock_timeout = '1500ms'");

    try {
      await waiter.query('SELECT id FROM community.invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
      report(false, 'second connection waits while the row is locked', 'lock was not held');
    } catch (error) {
      report(error.code === '55P03', 'second connection waits while the row is locked', 'got ' + error.code);
    }

    await waiter.query('ROLLBACK');
    await holder.query('ROLLBACK');

    await waiter.query('BEGIN');
    await waiter.query("SET LOCAL lock_timeout = '1500ms'");
    await waiter.query('SELECT id FROM community.invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    report(true, 'lock is available again after the holder ends its transaction');
    await waiter.query('ROLLBACK');
  } finally {
    holder.release();
    waiter.release();
  }
}

async function partC() {
  console.log('\n== Part C: concurrent payments (PERMANENT writes)');
  const balance = await db.query(
    'SELECT remaining_amount_minor::INTEGER AS remaining FROM community.invoice_balances WHERE id = $1',
    [args.invoice]
  );

  if (balance.rowCount === 0 || balance.rows[0].remaining < 3) {
    report(false, 'test invoice exists and has a remaining balance of at least 3');
    return;
  }

  const remaining = balance.rows[0].remaining;
  // Three payments that each fit alone but together exceed the balance.
  const share = Math.floor(remaining / 2) + 1;
  const runId = randomUUID().slice(0, 8);

  const results = await Promise.allSettled([0, 1, 2].map((index) =>
    recordPayment({
      user: { id: args.admin, role: 'ADMIN' },
      idempotencyKey: randomUUID(),
      body: {
        invoiceId: args.invoice,
        amountMinor: share,
        paymentReference: 'LOCKTEST-' + runId + '-' + index,
        paymentMethod: 'BANK_TRANSFER',
        paidAt: new Date().toISOString()
      },
      requestId: 'lock-check-' + runId
    })
  ));

  const accepted = results.filter((r) => r.status === 'fulfilled').length;
  const overpaid = results.filter((r) => r.status === 'rejected' && r.reason.code === 'OVERPAYMENT').length;
  const after = await db.query(
    'SELECT remaining_amount_minor::INTEGER AS remaining FROM community.invoice_balances WHERE id = $1',
    [args.invoice]
  );

  report(accepted === 1, 'exactly one concurrent payment accepted', String(accepted));
  report(overpaid === 2, 'the other two rejected with OVERPAYMENT', String(overpaid));
  report(after.rows[0].remaining >= 0, 'remaining balance never negative', String(after.rows[0].remaining));
}

try {
  await partA();
  await partB();

  if (args.invoice || args.admin || args['confirm-writes']) {
    if (!args.invoice || !args.admin || !args['confirm-writes']) {
      console.log('\nPart C needs --invoice, --admin and --confirm-writes together.');
      failures += 1;
    } else {
      await partC();
    }
  } else {
    console.log('\nPart C skipped (no --confirm-writes).');
  }
} catch (error) {
  console.error('Check aborted. Code:', error.code || 'UNKNOWN', '-', error.message);
  failures += 1;
} finally {
  await db.end();
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exitCode = failures === 0 ? 0 : 1;
