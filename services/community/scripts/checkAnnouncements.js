// REAL DATABASE integration check for announcement visibility and read
// receipts, run as community_app. Everything happens in ONE transaction
// that is rolled back, so nothing is written to the shared database.
//
// Run from services/community:
//   node --env-file=.env scripts/checkAnnouncements.js
//     SQL and privilege check only (placeholder ids, no rows).
//
//   node --env-file=.env scripts/checkAnnouncements.js \
//     --admin <adminUserId> --resident <residentUserId> \
//     --building <residentBuildingId> --other-building <anotherBuildingId>
//     Full visibility check with temporary rows (still rolled back).
//     Real ids are required because of foreign keys to identity tables.
import { parseArgs } from 'node:util';
import { getDatabase } from '../src/config/database.js';
import {
  insertReadReceipt,
  lockAnnouncement,
  updateAnnouncement,
  selectAnnouncementForAdmin,
  selectAnnouncementsForAdmin,
  selectReadReceipts,
  selectVisibleAnnouncement,
  selectVisibleAnnouncements
} from '../src/repositories/announcementRepository.js';

const { values: args } = parseArgs({
  options: {
    admin: { type: 'string' },
    resident: { type: 'string' },
    building: { type: 'string' },
    'other-building': { type: 'string' }
  }
});

const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
const db = getDatabase();
const client = await db.connect();
let failures = 0;

function report(passed, name, detail = '') {
  if (!passed) failures += 1;
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
}

async function sqlOnly() {
  console.log('== SQL and privileges (placeholder ids)');
  const list = await selectVisibleAnnouncements(client, {
    userId: PLACEHOLDER, buildingId: PLACEHOLDER, limit: 5, offset: 0
  });
  report(Array.isArray(list.announcements), 'resident visibility query runs');

  const admin = await selectAnnouncementsForAdmin(client, {
    status: 'SCHEDULED', audienceType: 'BUILDING', buildingId: PLACEHOLDER, limit: 5, offset: 0
  });
  report(Array.isArray(admin.announcements), 'admin list with effective-status filter runs');

  report(await selectAnnouncementForAdmin(client, PLACEHOLDER) === null, 'admin detail query runs');
  report(await selectVisibleAnnouncement(client, {
    userId: PLACEHOLDER, buildingId: null, announcementId: PLACEHOLDER
  }) === null, 'resident detail query runs');

  const receipt = await insertReadReceipt(client, {
    userId: PLACEHOLDER, buildingId: null, announcementId: PLACEHOLDER
  });
  report(receipt.eligible === false, 'read receipt refused for a missing announcement');
  report(Array.isArray(await selectReadReceipts(client, PLACEHOLDER)), 'read receipt list runs');

  report(await lockAnnouncement(client, PLACEHOLDER) === null, 'announcement row lock (FOR UPDATE) runs');
  report(await updateAnnouncement(client, PLACEHOLDER, {
    title: 'Placeholder', body: 'Placeholder body', audienceType: 'ALL', buildingId: null,
    storedStatus: 'DRAFT', publishAt: null, expiresAt: null, approvedBy: null
  }) === undefined, 'announcement update query runs');

  const privileges = await client.query(
    `SELECT has_table_privilege(current_user, 'community.announcements', 'DELETE') AS "deleteAnnouncements",
            has_table_privilege(current_user, 'community.announcement_reads', 'UPDATE') AS "updateReads",
            has_table_privilege(current_user, 'community.announcement_reads', 'DELETE') AS "deleteReads"`
  );
  const p = privileges.rows[0];
  report(!p.deleteAnnouncements && !p.updateReads && !p.deleteReads,
    'announcements cannot be deleted; read receipts cannot be changed or deleted');
}

async function insertRow(label, { audienceType = 'ALL', buildingId = null, status, publishOffset, expireOffset }) {
  const result = await client.query(
    `INSERT INTO community.announcements
       (title, body, audience_type, building_id, status, publish_at, expires_at, created_by, approved_by)
     VALUES ($1, 'Temporary rolled-back check row.', $2, $3, $4::VARCHAR,
       CASE WHEN $5::TEXT IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + $5::INTERVAL END,
       CASE WHEN $6::TEXT IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + $6::INTERVAL END,
       $7, CASE WHEN $4::VARCHAR = 'DRAFT' THEN NULL ELSE $7::UUID END)
     RETURNING id`,
    ['CHECK ' + label, audienceType, buildingId, status, publishOffset ?? null, expireOffset ?? null, args.admin]
  );
  return result.rows[0].id;
}

async function visibility() {
  console.log('\n== Visibility with temporary rows (rolled back)');

  const ids = {
    all: await insertRow('all', { status: 'PUBLISHED', publishOffset: '-1 hour' }),
    ownBuilding: await insertRow('own building', {
      audienceType: 'BUILDING', buildingId: args.building, status: 'PUBLISHED', publishOffset: '-1 hour'
    }),
    otherBuilding: await insertRow('other building', {
      audienceType: 'BUILDING', buildingId: args['other-building'], status: 'PUBLISHED', publishOffset: '-1 hour'
    }),
    draft: await insertRow('draft', { status: 'DRAFT' }),
    scheduled: await insertRow('scheduled', { status: 'SCHEDULED', publishOffset: '1 hour' }),
    expired: await insertRow('expired', { status: 'PUBLISHED', publishOffset: '-2 hours', expireOffset: '-1 hour' }),
    // Stored as SCHEDULED, but its time has come: must show as PUBLISHED.
    becamePublished: await insertRow('became published', { status: 'SCHEDULED', publishOffset: '-1 minute' })
  };

  const created = new Set(Object.values(ids));
  const visibleIds = async (buildingId) => {
    const { announcements } = await selectVisibleAnnouncements(client, {
      userId: args.resident, buildingId, limit: 100, offset: 0
    });
    return new Set(announcements.map((a) => a.id).filter((id) => created.has(id)));
  };

  const seen = await visibleIds(args.building);
  report(seen.has(ids.all), 'resident sees ALL announcement');
  report(seen.has(ids.ownBuilding), 'resident sees own building announcement');
  report(!seen.has(ids.otherBuilding), 'resident does not see another building');
  report(!seen.has(ids.draft), 'resident does not see drafts');
  report(!seen.has(ids.scheduled), 'resident does not see scheduled announcements early');
  report(!seen.has(ids.expired), 'resident does not see expired announcements');
  report(seen.has(ids.becamePublished), 'scheduled announcement appears once its time arrives');

  const noBuilding = await visibleIds(null);
  report(noBuilding.has(ids.all) && !noBuilding.has(ids.ownBuilding),
    'a resident without a building sees only ALL announcements');

  const statuses = {};
  for (const [key, id] of Object.entries(ids)) {
    statuses[key] = (await selectAnnouncementForAdmin(client, id)).status;
  }
  report(statuses.draft === 'DRAFT' && statuses.scheduled === 'SCHEDULED' &&
    statuses.expired === 'EXPIRED' && statuses.becamePublished === 'PUBLISHED',
    'admin sees derived statuses', JSON.stringify(statuses));

  const receiptArgs = { userId: args.resident, buildingId: args.building };
  const first = await insertReadReceipt(client, { ...receiptArgs, announcementId: ids.all });
  const again = await insertReadReceipt(client, { ...receiptArgs, announcementId: ids.all });
  report(first.eligible && first.firstRead, 'first read receipt recorded');
  report(again.eligible && !again.firstRead &&
    new Date(again.readAt).getTime() === new Date(first.readAt).getTime(),
    'repeated read receipt is idempotent');

  for (const key of ['otherBuilding', 'draft', 'scheduled', 'expired']) {
    const refused = await insertReadReceipt(client, { ...receiptArgs, announcementId: ids[key] });
    report(!refused.eligible, 'read receipt refused for ' + key);
  }

  const reads = await selectReadReceipts(client, ids.all);
  report(reads.length === 1 && reads[0].userId === args.resident, 'admin read receipt list shows one reader');
}

try {
  await client.query('BEGIN');
  await sqlOnly();

  if (args.admin && args.resident && args.building && args['other-building']) {
    await visibility();
  } else {
    console.log('\nVisibility check skipped (needs --admin, --resident, --building, --other-building).');
  }
} catch (error) {
  console.error('Check aborted. Code:', error.code || 'UNKNOWN', '-', error.message);
  failures += 1;
} finally {
  await client.query('ROLLBACK');
  client.release();
  await db.end();
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
process.exitCode = failures === 0 ? 0 : 1;
