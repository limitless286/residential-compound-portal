import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { aws } from './monitoring-aws.mjs';
import { validateMonitorConfig } from '../../services/maintenance/src/config/overdueMonitorConfig.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const mode = process.argv[2];
if (!['pause', 'manual', 'enable'].includes(mode)) throw new Error('Use pause, manual or enable.');
const mappingId = readFileSync('.deployment/monitor-mapping-id.txt', 'utf8').trim();
const ruleName = 'compound-maintenance-overdue-schedule';
aws(['events', 'disable-rule', '--name', ruleName]);
const stored = aws(['ssm', 'get-parameter', '--name', '/compound/maintenance/overdue-monitor']);
const cfg = validateMonitorConfig(JSON.parse(stored.Parameter.Value));
const path = resolve(root, '.deployment/monitor-state-value.json');
function put(enabled) {
  writeFileSync(path, JSON.stringify({ ...cfg, enabled }));
  aws(['ssm', 'put-parameter', '--name', '/compound/maintenance/overdue-monitor', '--type', 'String', '--overwrite', '--value', 'file://' + path]);
}
put(false);
aws(['lambda', 'update-event-source-mapping', '--uuid', mappingId, '--no-enabled']);
for (let attempt = 0; attempt < 40; attempt++) {
  const mapping = aws(['lambda', 'get-event-source-mapping', '--uuid', mappingId]);
  if (mapping.State === 'Disabled') break;
  if (attempt === 39) throw new Error('Consumer did not pause.');
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (mode !== 'pause') {
  const configured = JSON.parse(readFileSync('.deployment/monitor-environment.json', 'utf8')).Variables;
  const actual = aws(['lambda', 'get-function-configuration', '--function-name', 'compound-maintenance-overdue-consumer', '--query', 'Environment.Variables']);
  if (actual.MONITOR_EXPECTED_ENDPOINT !== configured.MONITOR_EXPECTED_ENDPOINT ||
      actual.OVERDUE_DATABASE_SECRET_ID !== configured.OVERDUE_DATABASE_SECRET_ID) throw new Error('Deploy the current monitor configuration first.');
  aws(['lambda', 'update-event-source-mapping', '--uuid', mappingId, '--enabled']);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (aws(['lambda', 'get-event-source-mapping', '--uuid', mappingId]).State === 'Enabled') break;
    if (attempt === 39) throw new Error('Consumer did not enable.');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  put(true);
  if (mode === 'enable') aws(['events', 'enable-rule', '--name', ruleName]);
}
console.log(mode === 'pause'
  ? 'PASS: schedule, scanning flag and consumer mapping paused.'
  : mode === 'manual'
    ? 'PASS: manual scans and consumer enabled; automatic schedule remains disabled.'
    : 'PASS: automatic overdue monitoring enabled.');
