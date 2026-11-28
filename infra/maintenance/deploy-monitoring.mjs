import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { aws } from './monitoring-aws.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const path = name => resolve(root, '.deployment', name);
const configuration = JSON.parse(readFileSync(path('monitor-environment.json'), 'utf8'));
const vars = configuration.Variables;
if (!vars.MONITOR_EXPECTED_ENDPOINT || !vars.OVERDUE_DATABASE_SECRET_ID || vars.DATABASE_URL) {
  throw new Error('Unexpected monitoring configuration.');
}
const config = aws(['ssm', 'get-parameter', '--name', '/compound/maintenance/overdue-monitor']);
if (JSON.parse(config.Parameter.Value).enabled !== false) throw new Error('Pause monitoring before deploying.');
const existingMappings = aws(['lambda', 'list-event-source-mappings', '--function-name', 'compound-maintenance-overdue-consumer'], true);
if ((existingMappings?.EventSourceMappings || []).some(item => item.State !== 'Disabled')) {
  throw new Error('Pause the consumer mapping before deploying.');
}
const stackName = 'compound-maintenance-monitoring';
const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName], true);
let changed = true;
try {
  aws(['cloudformation', stack ? 'update-stack' : 'create-stack', '--stack-name', stackName,
    '--template-body', 'file://infra/maintenance/monitoring-stack.json',
    '--parameters', 'file://' + path('monitor-stack-parameters.json'),
    '--capabilities', 'CAPABILITY_NAMED_IAM']);
} catch (error) {
  // Compare exact normalized template/parameters to distinguish no-op updates
  // from unsupported resources or deployment errors.
  if (!stack) throw error;
  const current = aws(['cloudformation', 'get-template', '--stack-name', stackName]);
  const body = typeof current.TemplateBody === 'string' ? JSON.parse(current.TemplateBody) : current.TemplateBody;
  const desired = JSON.parse(readFileSync('infra/maintenance/monitoring-stack.json', 'utf8'));
  const parameters = stack.Stacks[0].Parameters || [];
  const desiredParameters = JSON.parse(readFileSync(path('monitor-stack-parameters.json'), 'utf8'));
  if (JSON.stringify(body) !== JSON.stringify(desired) ||
      desiredParameters.some(p => !parameters.some(c => c.ParameterKey === p.ParameterKey && c.ParameterValue === p.ParameterValue))) throw error;
  changed = false;
}
if (changed) aws(['cloudformation', 'wait', stack ? 'stack-update-complete' : 'stack-create-complete', '--stack-name', stackName]);
console.log('PASS: monitoring CloudFormation resources configured; schedule disabled.');

const packagePath = path('maintenance-linux.zip');
for (const [kind, timeout] of [['scanner', '60'], ['consumer', '30']]) {
  const name = 'compound-maintenance-overdue-' + kind;
  const existing = aws(['lambda', 'get-function-configuration', '--function-name', name], true);
  const base = [
    '--function-name', name, '--runtime', 'nodejs24.x',
    '--handler', 'src/workers/' + (kind === 'scanner' ? 'overdueScanner' : 'overdueConsumer') + '.handler',
    '--role', 'arn:aws:iam::000000000000:role/' + name + '-role',
    '--environment', 'file://' + path('monitor-environment.json'),
    '--timeout', timeout, '--memory-size', '256', '--query', 'FunctionName'
  ];
  if (!existing) {
    aws(['lambda', 'create-function', ...base, '--architectures', 'x86_64', '--zip-file', 'fileb://' + packagePath]);
    aws(['lambda', 'wait', 'function-active-v2', '--function-name', name]);
  } else {
    aws(['lambda', 'update-function-configuration', ...base]);
    aws(['lambda', 'wait', 'function-updated-v2', '--function-name', name]);
    aws(['lambda', 'update-function-code', '--function-name', name, '--zip-file', 'fileb://' + packagePath, '--query', 'FunctionName']);
    aws(['lambda', 'wait', 'function-updated-v2', '--function-name', name]);
  }
  console.log('PASS: ' + kind + ' Lambda deployed.');
}
const scanner = 'compound-maintenance-overdue-scanner';
const sid = 'maintenance-overdue-schedule';
const policy = aws(['lambda', 'get-policy', '--function-name', scanner], true);
if (policy && JSON.parse(policy.Policy).Statement.some(item => item.Sid === sid)) {
  aws(['lambda', 'remove-permission', '--function-name', scanner, '--statement-id', sid]);
}
aws(['lambda', 'add-permission', '--function-name', scanner, '--statement-id', sid,
  '--action', 'lambda:InvokeFunction', '--principal', 'events.amazonaws.com',
  '--source-account', '000000000000',
  '--source-arn', 'arn:aws:events:us-east-1:000000000000:rule/compound-maintenance-overdue-schedule']);
const mappings = aws(['lambda', 'list-event-source-mappings', '--function-name', 'compound-maintenance-overdue-consumer']).EventSourceMappings || [];
const matches = mappings.filter(item => item.EventSourceArn === vars.OVERDUE_QUEUE_ARN);
if (matches.length > 1 || mappings.length !== matches.length) throw new Error('Unexpected consumer mappings.');
const mapping = matches[0]
  ? aws(['lambda', 'update-event-source-mapping', '--uuid', matches[0].UUID, '--no-enabled', '--batch-size', '1', '--function-response-types', 'ReportBatchItemFailures'])
  : aws(['lambda', 'create-event-source-mapping', '--function-name', 'compound-maintenance-overdue-consumer', '--event-source-arn', vars.OVERDUE_QUEUE_ARN,
    '--no-enabled', '--batch-size', '1', '--function-response-types', 'ReportBatchItemFailures']);
for (let attempt = 0; attempt < 40; attempt++) {
  if (aws(['lambda', 'get-event-source-mapping', '--uuid', mapping.UUID]).State === 'Disabled') break;
  if (attempt === 39) throw new Error('Consumer mapping did not become disabled.');
  await new Promise(resolve => setTimeout(resolve, 500));
}
writeFileSync(path('monitor-mapping-id.txt'), mapping.UUID + '\n');
writeFileSync(path('monitor-disabled-event.json'), JSON.stringify({ source: 'compound.maintenance.monitor', action: 'scan' }));
const responseFile = path('monitor-disabled-response.json');
const metadata = aws(['lambda', 'invoke', '--function-name', scanner, '--payload', 'fileb://' + path('monitor-disabled-event.json'), '--cli-read-timeout', '120', responseFile]);
if (metadata.FunctionError) throw new Error('Scanner invocation failed. Inspect its logs without exposing credentials.');
const response = JSON.parse(readFileSync(responseFile, 'utf8'));
if (response.enabled !== false || response.queued !== 0) throw new Error('Expected a disabled scan.');
console.log('PASS: deployed scanner read SSM and stopped while monitoring is disabled.');
console.log('PASS: consumer mapping created disabled. Nothing is processing automatically.');
console.log('Monitor database endpoint:', vars.MONITOR_EXPECTED_ENDPOINT);
