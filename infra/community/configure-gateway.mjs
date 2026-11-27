import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputDirectory = resolve(projectRoot, '.deployment');

const profile = process.env.FLOCI_DEPLOY_PROFILE || 'floci';
const endpoint = (
  process.env.FLOCI_DEPLOY_ENDPOINT || 'http://127.0.0.1:4566'
).replace(/\/+$/, '');

const executable = process.platform === 'win32' ? 'aws.exe' : 'aws';
const functionName = 'compound-community';
const apiName = 'compound-community-api';
const functionArn =
  'arn:aws:lambda:us-east-1:000000000000:function:' + functionName;

function aws(args, allowMissing = false) {
  try {
    const output = execFileSync(executable, [
      ...args,
      '--profile', profile,
      '--endpoint-url', endpoint,
      '--region', 'us-east-1',
      '--output', 'json',
      '--no-cli-pager'
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return output.trim() ? JSON.parse(output) : null;
  } catch (error) {
    const message = String(error.stderr || '');

    if (
      allowMissing &&
      /ResourceNotFoundException|NotFoundException/.test(message)
    ) {
      return null;
    }

    throw new Error(
      `${args[0]} ${args[1]} failed: ${message.trim()}`
    );
  }
}

mkdirSync(outputDirectory, { recursive: true });

const apis = aws(['apigateway', 'get-rest-apis']);
const matches = (apis.items || []).filter(api => api.name === apiName);

if (matches.length > 1) {
  throw new Error('Multiple community APIs found. Review before continuing.');
}

const api = matches[0] || aws([
  'apigateway', 'create-rest-api',
  '--name', apiName,
  '--description', 'Community fees, payments and announcements API'
]);

writeFileSync(
  resolve(outputDirectory, 'community-api-id.txt'),
  api.id + '\n'
);

const resources = aws([
  'apigateway', 'get-resources',
  '--rest-api-id', api.id
]);

const root = resources.items.find(resource => resource.path === '/');

if (!root) {
  throw new Error('API root resource was not found.');
}

const proxy = resources.items.find(
  resource => resource.path === '/{proxy+}'
) || aws([
  'apigateway', 'create-resource',
  '--rest-api-id', api.id,
  '--parent-id', root.id,
  '--path-part', '{proxy+}'
]);

// Authentication is enforced by the application (identity introspection),
// the same as maintenance. The gateway method itself is not an authorizer.
if (proxy.resourceMethods?.ANY) {
  const method = aws([
    'apigateway', 'get-method',
    '--rest-api-id', api.id,
    '--resource-id', proxy.id,
    '--http-method', 'ANY'
  ]);

  if (method.authorizationType !== 'NONE') {
    throw new Error('Unexpected Gateway authorization configuration.');
  }
} else {
  aws([
    'apigateway', 'put-method',
    '--rest-api-id', api.id,
    '--resource-id', proxy.id,
    '--http-method', 'ANY',
    '--authorization-type', 'NONE'
  ]);
}

aws([
  'apigateway', 'put-integration',
  '--rest-api-id', api.id,
  '--resource-id', proxy.id,
  '--http-method', 'ANY',
  '--type', 'AWS_PROXY',
  '--integration-http-method', 'POST',
  '--uri',
  `arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/${functionArn}/invocations`
]);

const permissionId = 'community-api-dev';
const policyResult = aws([
  'lambda', 'get-policy',
  '--function-name', functionName
], true);

const statements = policyResult
  ? JSON.parse(policyResult.Policy).Statement
  : [];

if (statements.some(statement => statement.Sid === permissionId)) {
  aws([
    'lambda', 'remove-permission',
    '--function-name', functionName,
    '--statement-id', permissionId
  ]);
}

// Only this API's dev stage may invoke the community function.
aws([
  'lambda', 'add-permission',
  '--function-name', functionName,
  '--statement-id', permissionId,
  '--action', 'lambda:InvokeFunction',
  '--principal', 'apigateway.amazonaws.com',
  '--source-account', '000000000000',
  '--source-arn',
  `arn:aws:execute-api:us-east-1:000000000000:${api.id}/dev/*/*`
]);

aws([
  'apigateway', 'create-deployment',
  '--rest-api-id', api.id,
  '--stage-name', 'dev'
]);

const baseUrl =
  `${endpoint}/restapis/${api.id}/dev/_user_request_/api/v1`;

const response = await fetch(`${baseUrl}/health`, {
  signal: AbortSignal.timeout(120000)
});

if (response.status !== 200) {
  throw new Error(`Gateway health returned HTTP ${response.status}.`);
}

const body = await response.json();

if (
  body.data?.service !== 'community' ||
  body.data?.status !== 'ok'
) {
  throw new Error('Unexpected Gateway health response.');
}

console.log('PASS: community API Gateway configured and health check passed.');
console.log('Community API:', baseUrl);
