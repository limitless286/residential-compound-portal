import assert from 'node:assert/strict';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDb } from '../src/config/dynamoDb.js';
import { loginLimiter } from '../src/middleware/loginLimiter.js';

const tableName = process.env.LOGIN_LIMITS_TABLE_NAME;
assert.ok(tableName, 'LOGIN_LIMITS_TABLE_NAME is missing.');

const windowMs = 15 * 60 * 1000;
const now = Date.now();

if (windowMs - (now % windowMs) < 30000) {
  throw new Error('Retry after 30 seconds: window boundary is too close.');
}

const clientIp = `198.19.${randomInt(256)}.${randomInt(1, 255)}`;
const fingerprint = createHash('sha256').update(clientIp).digest('hex');
const key = `login:${Math.floor(now / windowMs)}:${fingerprint}`;

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const req = { ip: clientIp, requestId: randomUUID() };

try {
  for (let index = 0; index < 10; index++) {
    let continued = false;
    await loginLimiter(req, createResponse(), () => {
      continued = true;
    });
    assert.equal(continued, true);
  }
  console.log('PASS: the first 10 attempts reach the login controller.');

  let continued = false;
  const blocked = createResponse();

  await loginLimiter(req, blocked, () => { continued = true; });

  assert.equal(continued, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  console.log('PASS: attempt 11 returns 429 with Retry-After.');

  process.env.LOGIN_LIMITS_TABLE_NAME = 'missing-login-test-' + randomUUID();

  await assert.rejects(
    () => loginLimiter(req, createResponse(), () => {
      assert.fail('A failed dependency must not allow login.');
    }),
    error =>
      error.status === 503 &&
      error.code === 'LOGIN_PROTECTION_UNAVAILABLE'
  );
  console.log('PASS: an unavailable table blocks login with 503.');
} finally {
  process.env.LOGIN_LIMITS_TABLE_NAME = tableName;

  try {
    await dynamoDb.send(new DeleteCommand({
      TableName: tableName,
      Key: { key }
    }));
    console.log('Test record deleted.');
  } finally {
    dynamoDb.destroy();
  }
}
