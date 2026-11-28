// Creates permanent, labelled fixtures ONLY on the agreed isolated Neon branch.
// Normal requests are never changed; fixture IDs and results are saved privately.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { aws } from './monitoring-aws.mjs';
import { recordOverdueNotification, findUnnotifiedOverdue } from '../../services/maintenance/src/repositories/overdueMonitorRepository.js';

if (!process.argv.includes('--confirm-writes')) throw new Error('This check creates test fixtures. Pass --confirm-writes to proceed.');
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const path = name => resolve(root, '.deployment', name);
const config = JSON.parse(readFileSync(path('monitor-environment.json'), 'utf8')).Variables;
const expected = 'ep-holy-sound-b9pf6vdt';
if (config.MONITOR_EXPECTED_ENDPOINT !== expected) throw new Error('Writes are restricted to community-testing.');
for (const kind of ['scanner', 'consumer']) {
  const env = aws(['lambda', 'get-function-configuration', '--function-name', 'compound-maintenance-overdue-' + kind, '--query', 'Environment.Variables']);
  assert.equal(env.MONITOR_EXPECTED_ENDPOINT, expected);
  assert.equal(env.OVERDUE_DATABASE_SECRET_ID, config.OVERDUE_DATABASE_SECRET_ID);
}
assert.equal(aws(['events', 'describe-rule', '--name', 'compound-maintenance-overdue-schedule']).State, 'DISABLED');
const mappingId = readFileSync(path('monitor-mapping-id.txt'), 'utf8').trim();
assert.equal(aws(['lambda', 'get-event-source-mapping', '--uuid', mappingId]).State, 'Disabled');
const initial = aws(['ssm', 'get-parameter', '--name', '/compound/maintenance/overdue-monitor']);
const oldConfig = JSON.parse(initial.Parameter.Value);
assert.equal(oldConfig.enabled, false);
const secret = aws(['secretsmanager', 'get-secret-value', '--secret-id', config.OVERDUE_DATABASE_SECRET_ID]);
const url = new URL(JSON.parse(secret.SecretString).DATABASE_URL);
assert.equal(decodeURIComponent(url.username), 'maintenance_app');
url.searchParams.set('sslmode', 'verify-full');
const require = createRequire(resolve(root, 'services/maintenance/package.json'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: url.toString(), enableChannelBinding: true, max: 5,
  connectionTimeoutMillis: 10000, statement_timeout: 8000 });
pool.on('error', () => {});
const run = randomUUID().slice(0, 8);
const evidence = { run, endpoint: expected, fixtures: [], checks: [], scheduledExecution: 'NOT_RUN', automaticDlqRetries: 'NOT_RUN' };
function pass(name) { evidence.checks.push({ name, passed: true }); console.log('PASS: ' + name); }
function invoke(name, payload) {
  const input = path('monitor-test-event.json');
  const output = path('monitor-test-response.json');
  writeFileSync(input, JSON.stringify(payload));
  const metadata = aws(['lambda', 'invoke', '--function-name', name, '--payload', 'fileb://' + input, '--cli-read-timeout', '120', output]);
  assert.equal(metadata.FunctionError, undefined, 'Lambda returned an execution error.');
  return JSON.parse(readFileSync(output, 'utf8'));
}
async function until(check, label, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out: ' + label);
}
async function fixture(label) {
  const result = await pool.query(
    `INSERT INTO maintenance.requests (
       user_id, unit_id, title, description, category, location_description,
       priority, status, due_at, created_at, updated_at
     ) SELECT u.id, u.unit_id, $1, 'Dedicated overdue monitoring integration fixture.',
       'OTHER', 'Isolated test branch', 'MEDIUM', 'OPEN',
       CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '8 days', CURRENT_TIMESTAMP
     FROM identity.users u WHERE u.role = 'RESIDENT' AND u.status = 'ACTIVE'
       AND u.unit_id IS NOT NULL ORDER BY u.id LIMIT 1
     RETURNING id,
       to_char(due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS due_at`, ['MONITOR-' + run + '-' + label]
  );
  assert.equal(result.rowCount, 1, 'An active test resident with a unit is required.');
  const row = result.rows[0];
  evidence.fixtures.push(row.id);
  return { requestId: row.id, dueAt: row.due_at };
}
async function count(requestId) {
  return Number((await pool.query('SELECT COUNT(*) AS count FROM maintenance.overdue_notifications WHERE request_id=$1', [requestId])).rows[0].count);
}
let mappingTouched = false;
try {
  const db = await pool.query("SELECT current_setting('neon.endpoint_id', true) AS endpoint, to_regclass('maintenance.overdue_notifications') AS notifications");
  assert.equal(db.rows[0].endpoint, expected);
  assert.ok(db.rows[0].notifications);
  const q = aws(['sqs', 'get-queue-attributes', '--queue-url', config.OVERDUE_QUEUE_URL, '--attribute-names', 'All']).Attributes;
  assert.equal(Number(q.ApproximateNumberOfMessages || 0), 0, 'Queue must be empty before tests.');
  assert.equal(Number(q.ApproximateNumberOfMessagesNotVisible || 0), 0);
  pass('actual isolated endpoint verified before writes');

  const live = await fixture('LIVE');
  const scanEvent = { source: 'compound.maintenance.monitor', action: 'scan' };
  assert.equal(invoke('compound-maintenance-overdue-scanner', scanEvent).enabled, false);
  assert.equal(await count(live.requestId), 0);
  pass('disabled deployed scanner records no alerts');

  const time = new Date((await pool.query('SELECT statement_timestamp() AS now')).rows[0].now);
  const hours = oldConfig.repeatAfterHours;
  const windowStart = new Date(Math.floor(time.getTime() / (hours * 3600000)) * hours * 3600000).toISOString();
  const makeJob = item => ({ type: 'MAINTENANCE_OVERDUE_V1', ...item, windowStart, repeatAfterHours: hours });
  const race = await fixture('RACE');
  const raceResults = await Promise.all(Array.from({ length: 8 }, () => recordOverdueNotification(pool, makeJob(race))));
  assert.equal(raceResults.filter(item => item.created).length, 1);
  assert.equal(await count(race.requestId), 1);
  assert.equal((await recordOverdueNotification(pool, { ...makeJob(race), windowStart: new Date(Date.parse(windowStart) - 3600000).toISOString() })).created, false);
  pass('concurrent deliveries and another window cannot bypass the cooldown');

  for (const [label, change] of [
    ['RESOLVED', "status='RESOLVED', resolved_at=CURRENT_TIMESTAMP"],
    ['CLOSED', "status='CLOSED', resolved_at=CURRENT_TIMESTAMP, closed_at=CURRENT_TIMESTAMP"],
    ['DEADLINE', "due_at=CURRENT_TIMESTAMP + INTERVAL '1 day'"]
  ]) {
    const item = await fixture(label);
    await pool.query('UPDATE maintenance.requests SET ' + change + ', updated_at=CURRENT_TIMESTAMP WHERE id=$1', [item.requestId]);
    assert.equal((await recordOverdueNotification(pool, makeJob(item))).created, false);
    assert.equal(await count(item.requestId), 0);
  }
  pass('resolved, closed and changed-deadline jobs are skipped on real PostgreSQL');

  const consumerInvalid = invoke('compound-maintenance-overdue-consumer', { Records: [{
    eventSource: 'aws:sqs', eventSourceARN: config.OVERDUE_QUEUE_ARN,
    messageId: 'invalid-test-message', body: '{invalid-json'
  }] });
  assert.deepEqual(consumerInvalid.batchItemFailures, [{ itemIdentifier: 'invalid-test-message' }]);
  pass('deployed consumer reports invalid messages for retry');

  mappingTouched = true;
  execFileSync(process.execPath, ['infra/maintenance/set-monitor-state.mjs', 'manual'], { stdio: 'inherit' });
  const scan = invoke('compound-maintenance-overdue-scanner', scanEvent);
  assert.equal(scan.enabled, true);
  assert.ok(scan.queued > 0);
  await until(async () => await count(live.requestId) === 1, 'SQS consumer persistence');
  pass('deployed scanner → SQS → deployed consumer → Neon notification');
  const replay = invoke('compound-maintenance-overdue-consumer', { Records: [{
    eventSource: 'aws:sqs', eventSourceARN: config.OVERDUE_QUEUE_ARN,
    messageId: 'repeat-test-message', body: JSON.stringify(makeJob(live))
  }] });
  assert.deepEqual(replay.batchItemFailures, []);
  assert.equal(await count(live.requestId), 1);
  const nextScan = invoke('compound-maintenance-overdue-scanner', scanEvent);
  assert.equal(nextScan.enabled, true);
  const candidates = await findUnnotifiedOverdue(pool, {
    asOf: new Date().toISOString(), windowStart, repeatAfterHours: hours, limit: 100
  });
  assert.equal(candidates.some(item => item.requestId === live.requestId), false);
  pass('replayed delivery and repeated scan do not duplicate the recorded alert');
  await until(async () => {
    const attrs = aws(['sqs', 'get-queue-attributes', '--queue-url', config.OVERDUE_QUEUE_URL, '--attribute-names', 'All']).Attributes;
    return Number(attrs.ApproximateNumberOfMessages || 0) === 0 && Number(attrs.ApproximateNumberOfMessagesNotVisible || 0) === 0;
  }, 'queue drain');
  evidence.completed = true;
} catch (error) {
  evidence.completed = false;
  evidence.failure = error instanceof assert.AssertionError ? ('Assertion failed: ' + error.message) : 'Integration check failed; inspect the service and resource state.';
  console.error('FAIL:', evidence.failure);
  process.exitCode = 1;
} finally {
  if (mappingTouched) {
    try { execFileSync(process.execPath, ['infra/maintenance/set-monitor-state.mjs', 'pause'], { stdio: 'inherit' }); }
    catch { console.error('IMPORTANT: pause monitoring manually; automatic cleanup failed.'); process.exitCode = 1; }
  }
  await pool.end();
  writeFileSync(path('monitoring-integration-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('Labelled fixtures retained on community-testing; evidence saved privately.');
}
