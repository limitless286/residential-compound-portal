import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputDirectory = resolve(projectRoot, '.deployment');

execFileSync('git', [
  '-C', projectRoot,
  'check-ignore', '--quiet', '--',
  '.deployment/maintenance-environment.json'
], { stdio: 'ignore' });

const local = parseEnv(readFileSync(
  resolve(projectRoot, 'services/maintenance/.env'),
  'utf8'
));

const variables = {};

for (const name of ['SESSIONS_TABLE_NAME', 'LOGIN_LIMITS_TABLE_NAME']) {
  if (!local[name]?.trim()) {
    throw new Error('Missing configuration: ' + name);
  }

  variables[name] = local[name].trim();
}

if (
  variables.SESSIONS_TABLE_NAME !== 'compound-sessions' ||
  variables.LOGIN_LIMITS_TABLE_NAME !== 'compound-login-limits'
) {
  throw new Error('Table names must match the maintenance IAM policy.');
}

variables.MAINTENANCE_SECRET_ID = 'compound/maintenance/runtime';
variables.SECRETS_MANAGER_ENDPOINT_URL = 'http://floci:4566';
variables.DYNAMODB_ENDPOINT_URL = 'http://floci:4566';
variables.NODE_ENV = 'development';
variables.DEMO_SEED_ENABLED = local.DEMO_SEED_ENABLED || 'false';

if (!['true', 'false'].includes(variables.DEMO_SEED_ENABLED)) {
  throw new Error('DEMO_SEED_ENABLED must be true or false.');
}

if (Buffer.byteLength(JSON.stringify(variables), 'utf8') > 4096) {
  throw new Error('Lambda environment exceeds the supported size.');
}

mkdirSync(outputDirectory, { recursive: true });

writeFileSync(
  resolve(outputDirectory, 'maintenance-environment.json'),
  JSON.stringify({ Variables: variables }, null, 2),
  { encoding: 'utf8', mode: 0o600 }
);

console.log('PASS: Lambda environment prepared with a secret reference.');
