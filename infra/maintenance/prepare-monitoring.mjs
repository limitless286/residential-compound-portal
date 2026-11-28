import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { aws } from './monitoring-aws.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const directory = resolve(root, '.deployment');
execFileSync('git', ['check-ignore', '--quiet', '--', '.deployment/monitor-environment.json'], { stdio: 'ignore' });
const inputPath = resolve(directory, 'monitor-private-input.json');
const payloadPath = resolve(directory, 'monitor-secret-payload.json');
const require = createRequire(resolve(root, 'services/maintenance/package.json'));
const { Pool } = require('pg');
let pool;
try {
  const input = JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, ''));
  if (process.env.MONITOR_CONFIG_USE_SERVICE_DATABASE === 'true') {
    input.databaseUrl = parseEnv(readFileSync('services/maintenance/.env', 'utf8')).DATABASE_URL;
  }
  const expected = input.expectedEndpoint;
  if (!/^ep-[a-z0-9-]+$/.test(expected || '')) throw new Error('Invalid expected endpoint.');
  if (expected !== 'ep-holy-sound-b9pf6vdt' && input.allowSharedDatabase !== true) {
    throw new Error('Only the agreed test endpoint is allowed without explicit shared-database selection.');
  }
  let url;
  try {
    url = new URL(input.databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        decodeURIComponent(url.username) !== 'maintenance_app' || !url.password ||
        url.pathname !== '/neondb' ||
        !(url.hostname.startsWith(expected + '-') || url.hostname.startsWith(expected + '.'))) throw new Error();
  } catch { throw new Error('Unexpected monitor database URL or runtime role.'); }

  const rule = aws(['events', 'describe-rule', '--name', 'compound-maintenance-overdue-schedule'], true);
  if (rule && rule.State !== 'DISABLED') throw new Error('Disable the monitoring schedule before changing its database.');
  const cfg = aws(['ssm', 'get-parameter', '--name', '/compound/maintenance/overdue-monitor']);
  if (JSON.parse(cfg.Parameter.Value).enabled !== false) throw new Error('Disable monitoring in SSM before configuration.');
  const mappings = aws(['lambda', 'list-event-source-mappings', '--function-name', 'compound-maintenance-overdue-consumer'], true);
  if ((mappings?.EventSourceMappings || []).some(item => item.State !== 'Disabled')) {
    throw new Error('Disable the consumer event source mapping before configuration.');
  }
  const queue = aws(['sqs', 'get-queue-url', '--queue-name', 'compound-maintenance-overdue']);
  const attributes = aws(['sqs', 'get-queue-attributes', '--queue-url', queue.QueueUrl, '--attribute-names', 'All']).Attributes;
  if (['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'].some(key => Number(attributes[key] || 0) !== 0)) {
    throw new Error('The monitor queue must be empty before changing database configuration.');
  }

  url.searchParams.set('sslmode', 'verify-full');
  pool = new Pool({ connectionString: url.toString(), enableChannelBinding: true,
    max: 1, connectionTimeoutMillis: 10000, statement_timeout: 8000 });
  pool.on('error', () => {});
  const result = await pool.query("SELECT current_user AS role, current_setting('neon.endpoint_id', true) AS endpoint, to_regclass('maintenance.overdue_notifications') AS notifications");
  if (result.rows[0]?.role !== 'maintenance_app' || result.rows[0]?.endpoint !== expected || !result.rows[0]?.notifications) {
    throw new Error('Actual database endpoint, role or migration 007 does not match.');
  }
  const privilege = await pool.query("SELECT has_table_privilege(current_user, 'maintenance.overdue_notifications', 'SELECT') AS read, has_table_privilege(current_user, 'maintenance.overdue_notifications', 'INSERT') AS insert, has_table_privilege(current_user, 'maintenance.overdue_notifications', 'UPDATE') AS update, has_table_privilege(current_user, 'maintenance.overdue_notifications', 'DELETE') AS delete");
  const rights = privilege.rows[0];
  if (!rights.read || !rights.insert || rights.update || rights.delete) throw new Error('Unexpected notification table privileges.');
  await pool.end(); pool = undefined;
  mkdirSync(directory, { recursive: true });
  writeFileSync(payloadPath, JSON.stringify({ DATABASE_URL: url.toString() }), { mode: 0o600 });
  const name = 'compound/maintenance/overdue/database';
  const existing = aws(['secretsmanager', 'describe-secret', '--secret-id', name], true);
  const secret = existing
    ? aws(['secretsmanager', 'put-secret-value', '--secret-id', name, '--secret-string', 'file://' + payloadPath])
    : aws(['secretsmanager', 'create-secret', '--name', name, '--secret-string', 'file://' + payloadPath]);
  const floci = (process.env.FLOCI_LAMBDA_ENDPOINT || 'http://floci:4566').replace(/\/+$/, '');
  const variables = {
    OVERDUE_DATABASE_SECRET_ID: secret.ARN, MONITOR_EXPECTED_ENDPOINT: expected,
    SECRETS_MANAGER_ENDPOINT_URL: floci, SSM_ENDPOINT_URL: floci, SQS_ENDPOINT_URL: floci,
    OVERDUE_QUEUE_URL: floci + new URL(queue.QueueUrl).pathname,
    OVERDUE_QUEUE_ARN: attributes.QueueArn, NODE_ENV: 'production'
  };
  writeFileSync(resolve(directory, 'monitor-environment.json'), JSON.stringify({ Variables: variables }, null, 2), { mode: 0o600 });
  writeFileSync(resolve(directory, 'monitor-stack-parameters.json'), JSON.stringify([
    { ParameterKey: 'MonitorSecretArn', ParameterValue: secret.ARN }
  ], null, 2), { mode: 0o600 });
  console.log('PASS: monitor database endpoint, migration and runtime privileges verified.');
  console.log('Monitor endpoint:', expected);
  console.log('PASS: database-only worker secret and private deployment configuration prepared.');
} catch (error) {
  const safe = /^(Invalid expected|Only the agreed|Unexpected monitor|Disable|The monitor queue|Actual database|Unexpected notification|Floci command)/.test(error.message);
  throw new Error(safe ? error.message : 'Monitor preparation failed. Check the private connection settings and database availability.');
} finally {
  if (pool) await pool.end().catch(() => {});
  for (const path of [inputPath, payloadPath]) {
    try { unlinkSync(path); } catch { /* input may not exist */ }
  }
}
