import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { aws } from './monitoring-aws.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const path = name => resolve(root, '.deployment', name);
const base = JSON.parse(readFileSync(path('monitor-environment.json'), 'utf8'));
const evidence = [];
for (const role of ['scanner', 'consumer']) {
  const name = 'compound-monitor-iam-probe-' + randomUUID().slice(0, 8);
  const envPath = path('monitor-probe-' + role + '-environment.json');
  writeFileSync(envPath, JSON.stringify({ Variables: { ...base.Variables, MONITOR_PROBE_ROLE: role } }));
  let created = false;
  try {
    aws(['lambda', 'create-function', '--function-name', name, '--runtime', 'nodejs24.x',
      '--handler', 'src/workers/overdueIamProbe.handler',
      '--role', 'arn:aws:iam::000000000000:role/compound-maintenance-overdue-' + role + '-role',
      '--environment', 'file://' + envPath, '--zip-file', 'fileb://' + path('maintenance-linux.zip'),
      '--timeout', '60', '--memory-size', '256', '--query', 'FunctionName']);
    created = true;
    aws(['lambda', 'wait', 'function-active-v2', '--function-name', name]);
    const output = path('monitor-iam-' + role + '-result.json');
    const meta = aws(['lambda', 'invoke', '--function-name', name, '--cli-read-timeout', '120', output]);
    if (meta.FunctionError) throw new Error('IAM probe execution failed.');
    const result = JSON.parse(readFileSync(output, 'utf8'));
    evidence.push(result);
    for (const check of result.checks) console.log((check.passed ? 'PASS' : 'FAIL') + ': ' + role + ': ' + check.name);
    if (!result.passed) throw new Error('Execution-role checks failed; do not broaden permissions without investigating.');
  } finally {
    if (created) aws(['lambda', 'delete-function', '--function-name', name]);
  }
}
writeFileSync(path('monitor-iam-evidence.json'), JSON.stringify(evidence, null, 2));
console.log('PASS: temporary IAM probe functions removed.');
