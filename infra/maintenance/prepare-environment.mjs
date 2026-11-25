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

const required = [
  'DATABASE_URL',
  'SESSIONS_TABLE_NAME',
  'LOGIN_LIMITS_TABLE_NAME',
  'BOOKINGS_AUTH_KEY',
  'COMMUNITY_AUTH_KEY'
];

const variables = {};

for (const name of required) {
  if (!local[name]?.trim()) {
    throw new Error('Missing configuration: ' + name);
  }
  variables[name] = local[name];
}

for (const name of ['BOOKINGS_AUTH_KEY', 'COMMUNITY_AUTH_KEY']) {
  if (!/^[a-f0-9]{64}$/.test(variables[name])) {
    throw new Error('Invalid service key configuration: ' + name);
  }
}

if (variables.BOOKINGS_AUTH_KEY === variables.COMMUNITY_AUTH_KEY) {
  throw new Error('Internal service keys must be distinct.');
}

if (
  variables.SESSIONS_TABLE_NAME !== 'compound-sessions' ||
  variables.LOGIN_LIMITS_TABLE_NAME !== 'compound-login-limits'
) {
  throw new Error('Table names must match the maintenance IAM policy.');
}

variables.DYNAMODB_ENDPOINT_URL = 'http://floci:4566';
variables.NODE_ENV = 'development';
variables.DEMO_SEED_ENABLED = local.DEMO_SEED_ENABLED || 'false';

if (!['true', 'false'].includes(variables.DEMO_SEED_ENABLED)) {
  throw new Error('DEMO_SEED_ENABLED must be true or false.');
}

const environment = { Variables: variables };

if (Buffer.byteLength(JSON.stringify(variables), 'utf8') > 4096) {
  throw new Error('Lambda environment exceeds the supported size.');
}

mkdirSync(outputDirectory, { recursive: true });

writeFileSync(
  resolve(outputDirectory, 'maintenance-environment.json'),
  JSON.stringify(environment, null, 2),
  { encoding: 'utf8', mode: 0o600 }
);

console.log('PASS: private Floci Lambda environment prepared.');
