// REAL DATABASE check of concurrent first reads, run as community_app.
// Run from services/community:
//
//   node --env-file=.env scripts/checkReadReceipts.js
//     Part A: read receipts are immutable for community_app. Writes nothing.
//
//   node --env-file=.env scripts/checkReadReceipts.js \
//     --announcement <id> --resident <userId> [--building <buildingId>] --confirm-writes
//     Part B: forces the race. Transaction 1 inserts the receipt and holds
//     it uncommitted; transaction 2 (the real service path) blocks on the
//     conflict; transaction 1 commits. Transaction 2 must return the same
//     non-null readAt. Then several parallel requests through the service
//     must all return that readAt.
//     This PERMANENTLY records one read receipt (community_app cannot
//     delete it). Use an announcement and resident agreed with the team,
//     published and visible to that resident, not yet read by them.
import { parseArgs } from 'node:util';
import { getDatabase, withTransaction } from '../src/config/database.js';
import { insertReadReceipt } from '../src/repositories/announcementRepository.js';
import { markAnnouncementRead } from '../src/services/announcementReadService.js';

const { values: args } = parseArgs({
  options: {
    announcement: { type: 'string' },
    resident: { type: 'string' },
    building: { type: 'string' },
    'confirm-writes': { type: 'boolean', default: false }
  }
});

const db = getDatabase();
let failures = 0;

function report(passed, name, detail = '') {
  if (!passed) failures += 1;
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
}

const iso = (value) => (value ? new Date(value).toISOString() : String(value));

async function partA() {
  console.log('\n== Part A: receipts are immutable (read-only)');
  const r = await db.query(
    `SELECT current_user AS name,
            has_table_privilege(current_user, 'community.announcement_reads', 'INSERT') AS "insert",
            has_table_privilege(current_user, 'community.announcement_reads', 'UPDATE') AS "update",
            has_table_privilege(current_user, 'community.announcement_reads', 'DELETE') AS "delete",
            current_setting('default_transaction_isolation') AS isolation`
  );
  const row = r.rows[0];
  report(row.name === 'community_app', 'connected as community_app', row.name);
  report(row.insert && !row.update && !row.delete, 'INSERT only: no UPDATE or DELETE on announcement_reads');
  report(row.isolation === 'read committed', 'READ COMMITTED isolation (each statement gets a new snapshot)',
    row.isolation);
}

async function waitUntilBlocked(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await db.query(
      `SELECT wait_event_type AS type FROM pg_stat_activity
       WHERE usename = current_user AND pid <> $1 AND wait_event_type = 'Lock'
         AND query LIKE '%announcement_reads%'`,
      [pid]
    );
    if (r.rowCount > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function partB() {
  console.log('\n== Part B: forced concurrent first read (PERMANENT write)');
  const receipt = {
    userId: args.resident.toLowerCase(),
    buildingId: args.building ? args.building.toLowerCase() : null,
    announcementId: args.announcement.toLowerCase()
  };

  const existing = await db.query(
    'SELECT 1 FROM community.announcement_reads WHERE announcement_id = $1 AND user_id = $2',
    [receipt.announcementId, receipt.userId]
  );
  if (existing.rowCount > 0) {
    report(false, 'resident has not read this announcement yet', 'pick a pair with no receipt');
    return;
  }

  const first = await db.connect();
  let second;

  try {
    await first.query('BEGIN');
    const pid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const winner = await insertReadReceipt(first, receipt);

    if (!winner.eligible) {
      report(false, 'announcement is visible to the resident');
      await first.query('ROLLBACK');
      return;
    }
    report(winner.firstRead && winner.readAt !== null, 'transaction 1 inserted the receipt (uncommitted)');

    // The real service path, in its own transaction with the real timeouts.
    second = withTransaction((client) => insertReadReceipt(client, receipt));

    report(await waitUntilBlocked(pid), 'transaction 2 is blocked on the uncommitted receipt');

    await first.query('COMMIT');
    const loser = await second;

    report(loser.eligible && !loser.firstRead, 'transaction 2 did not insert a second receipt');
    report(loser.readAt !== null, 'transaction 2 returned a non-null readAt', iso(loser.readAt));
    report(iso(loser.readAt) === iso(winner.readAt), 'both returned the same readAt',
      iso(winner.readAt) + ' vs ' + iso(loser.readAt));
  } catch (error) {
    await first.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    first.release();
  }

  const stored = await db.query(
    `SELECT read_at AS "readAt", COUNT(*) OVER ()::INTEGER AS n
     FROM community.announcement_reads WHERE announcement_id = $1 AND user_id = $2`,
    [receipt.announcementId, receipt.userId]
  );
  report(stored.rows.length === 1, 'exactly one receipt is stored', String(stored.rows.length));

  const parallel = await Promise.all([0, 1, 2, 3].map(() => markAnnouncementRead({
    user: { id: receipt.userId, role: 'RESIDENT', buildingId: receipt.buildingId },
    announcementId: receipt.announcementId,
    requestId: 'read-receipt-check'
  })));
  const storedAt = iso(stored.rows[0].readAt);
  report(parallel.every((r) => iso(r.readAt) === storedAt && !r.firstRead),
    'parallel repeat reads through the service all return the stored readAt', storedAt);
}

try {
  await partA();

  if (args.announcement || args.resident || args['confirm-writes']) {
    if (!args.announcement || !args.resident || !args['confirm-writes']) {
      console.log('\nPart B needs --announcement, --resident and --confirm-writes together.');
      failures += 1;
    } else {
      await partB();
    }
  } else {
    console.log('\nPart B skipped (no --confirm-writes).');
  }
} catch (error) {
  console.error('Check aborted. Code:', error.code || 'UNKNOWN', '-', error.message);
  failures += 1;
} finally {
  await db.end();
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exitCode = failures === 0 ? 0 : 1;
