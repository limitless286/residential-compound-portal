import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDb } from '../src/config/dynamoDb.js';
import { consumeLoginAttempt } from '../src/repositories/loginLimitRepository.js';

const tableName = process.env.LOGIN_LIMITS_TABLE_NAME;

if (!tableName) {
  throw new Error('LOGIN_LIMITS_TABLE_NAME is missing.');
}

const windowMs = 15 * 60 * 1000;
const now = Date.now();

if (windowMs - (now % windowMs) < 30000) {
  throw new Error('Too close to a window boundary. Retry after 30 seconds.');
}

const clientIdentifier = 'integration-test:' + randomUUID();
const fingerprint = createHash('sha256')
  .update(clientIdentifier)
  .digest('hex');

const key = `login:${Math.floor(now / windowMs)}:${fingerprint}`;

try {
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      consumeLoginAttempt(clientIdentifier)
    )
  );

  const errors = results.filter(result => result.status === 'rejected');
  assert.equal(errors.length, 0, 'Some DynamoDB requests failed.');

  const attempts = results.map(result => result.value);
  const allowed = attempts.filter(result => result.allowed).length;
  const blocked = attempts.filter(result => !result.allowed).length;

  assert.equal(allowed, 10);
  assert.equal(blocked, 10);
  console.log('PASS: 20 concurrent attempts allow 10 and block 10.');

  assert.equal(
    new Set(attempts.map(result => result.resetAt)).size,
    1
  );
  console.log('PASS: concurrent attempts share the same reset time.');

  const extra = await consumeLoginAttempt(clientIdentifier);
  assert.equal(extra.allowed, false);
  console.log('PASS: an additional attempt remains blocked.');

  const { Item } = await dynamoDb.send(new GetCommand({
    TableName: tableName,
    Key: { key },
    ConsistentRead: true
  }));

  assert.ok(Item, 'The counter was not found.');
  assert.equal(Item.attempts, 10);
  assert.equal(
    Item.expiresAt,
    Math.ceil(attempts[0].resetAt / 1000)
  );
  assert.deepEqual(
    Object.keys(Item).sort(),
    ['attempts', 'expiresAt', 'key']
  );
  console.log('PASS: stored counter is capped and contains no raw client identifier.');
} finally {
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
