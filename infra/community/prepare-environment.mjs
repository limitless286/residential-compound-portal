// Builds the private Lambda environment for community from
// services/community/.env. The result is written to .deployment/ (ignored by
// Git) and never printed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputDirectory = resolve(projectRoot, '.deployment');

execFileSync('git', [
  '-C', projectRoot,
  'check-ignore', '--quiet', '--',
  '.deployment/community-environment.json'
], { stdio: 'ignore' });

const local = parseEnv(readFileSync(
  resolve(projectRoot, 'services/community/.env'),
  'utf8'
));

const variables = {};

for (const name of ['DATABASE_URL', 'AUTH_SERVICE_KEY']) {
  if (!local[name]?.trim()) {
    throw new Error('Missing configuration: ' + name);
  }
  variables[name] = local[name].trim();
}

// Runtime must use the restricted community role, never an owner account.
const databaseUser = decodeURIComponent(new URL(variables.DATABASE_URL).username);

if (databaseUser !== 'community_app') {
  throw new Error('DATABASE_URL must use the restricted community_app role.');
}

if (!/^[a-f0-9]{64}$/.test(variables.AUTH_SERVICE_KEY)) {
  throw new Error('Invalid service key configuration: AUTH_SERVICE_KEY');
}

// Optional until the key is coordinated with maintenance. Without it the
// internal draft endpoint fails closed with 503.
const maintenanceKey = local.MAINTENANCE_AUTH_KEY?.trim();

if (maintenanceKey && !maintenanceKey.startsWith('YOUR_')) {
  if (!/^[a-f0-9]{64}$/.test(maintenanceKey) ||
      maintenanceKey === variables.AUTH_SERVICE_KEY) {
    throw new Error('Invalid service key configuration: MAINTENANCE_AUTH_KEY');
  }
  variables.MAINTENANCE_AUTH_KEY = maintenanceKey;
}

// Identity is reached through the maintenance API Gateway on this Floci,
// at an address the Lambda container can resolve (not 127.0.0.1).
const apiIdPath = resolve(outputDirectory, 'maintenance-api-id.txt');

if (!existsSync(apiIdPath)) {
  throw new Error(
    'Maintenance API ID not found. Run infra/maintenance/configure-gateway.mjs first.'
  );
}

const maintenanceApiId = readFileSync(apiIdPath, 'utf8').trim();

if (!/^[a-z0-9]{6,20}$/.test(maintenanceApiId)) {
  throw new Error('Unexpected maintenance API ID.');
}

const lambdaFlociUrl = (
  process.env.FLOCI_LAMBDA_ENDPOINT || 'http://floci:4566'
).replace(/\/+$/, '');

variables.IDENTITY_BASE_URL =
  `${lambdaFlociUrl}/restapis/${maintenanceApiId}/dev/_user_request_`;
variables.SERVICE_NAME = 'community';
variables.NODE_ENV = 'production';

if (Buffer.byteLength(JSON.stringify(variables), 'utf8') > 4096) {
  throw new Error('Lambda environment exceeds the supported size.');
}

mkdirSync(outputDirectory, { recursive: true });

writeFileSync(
  resolve(outputDirectory, 'community-environment.json'),
  JSON.stringify({ Variables: variables }, null, 2),
  { encoding: 'utf8', mode: 0o600 }
);

console.log('PASS: private community Lambda environment prepared.');
console.log('Identity via maintenance API:', maintenanceApiId,
  '| internal draft key:', variables.MAINTENANCE_AUTH_KEY ? 'configured' : 'not configured (503)');
