import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync
} from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const directory = resolve(root, '.deployment');
const payloadPath = resolve(directory, 'maintenance-secret-payload.json');

execFileSync('git', [
  'check-ignore', '--quiet', '--',
  '.deployment/maintenance-secret-payload.json'
], { stdio: 'ignore' });

const local = parseEnv(
  readFileSync('services/maintenance/.env', 'utf8')
);

const secret = {};

for (const name of [
  'DATABASE_URL',
  'BOOKINGS_AUTH_KEY',
  'COMMUNITY_AUTH_KEY'
]) {
  if (!local[name]?.trim()) {
    throw new Error('Missing configuration: ' + name);
  }

  secret[name] = local[name].trim();
}

if (decodeURIComponent(new URL(secret.DATABASE_URL).username) !== 'maintenance_app') {
  throw new Error('Database connection must use maintenance_app.');
}

for (const name of ['BOOKINGS_AUTH_KEY', 'COMMUNITY_AUTH_KEY']) {
  if (!/^[a-f0-9]{64}$/.test(secret[name])) {
    throw new Error('Invalid key configuration: ' + name);
  }
}

if (secret.BOOKINGS_AUTH_KEY === secret.COMMUNITY_AUTH_KEY) {
  throw new Error('Identity service keys must be distinct.');
}

const executable = process.platform === 'win32' ? 'aws.exe' : 'aws';
const secretName = 'compound/maintenance/runtime';

function aws(args, allowMissing = false) {
  try {
    const output = execFileSync(executable, [
      ...args,
      '--profile', 'floci',
      '--endpoint-url', 'http://127.0.0.1:4566',
      '--region', 'us-east-1',
      '--output', 'json',
      '--no-cli-pager'
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return output.trim() ? JSON.parse(output) : null;
  } catch (error) {
    if (allowMissing &&
        String(error.stderr).includes('ResourceNotFoundException')) {
      return null;
    }

    throw new Error('Secrets Manager command failed: ' + args[1]);
  }
}

const existing = aws([
  'secretsmanager', 'describe-secret',
  '--secret-id', secretName
], true);

mkdirSync(directory, { recursive: true });

try {
  writeFileSync(payloadPath, JSON.stringify(secret), {
    encoding: 'utf8',
    mode: 0o600
  });

  const result = existing
    ? aws([
        'secretsmanager', 'put-secret-value',
        '--secret-id', secretName,
        '--secret-string', 'file://' + payloadPath
      ])
    : aws([
        'secretsmanager', 'create-secret',
        '--name', secretName,
        '--description', 'Restricted maintenance runtime credentials',
        '--secret-string', 'file://' + payloadPath
      ]);

  writeFileSync(
    resolve(directory, 'maintenance-secret-arn.txt'),
    result.ARN + '\n',
    'utf8'
  );

  console.log('PASS: maintenance runtime secret saved in Secrets Manager.');
  console.log('Secret name:', secretName);
} finally {
  unlinkSync(payloadPath);
}
