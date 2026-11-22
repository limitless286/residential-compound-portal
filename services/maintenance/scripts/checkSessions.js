import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {
  saveSession,
  findSession,
  deleteSession
} from '../src/repositories/sessionRepository.js';
import { dynamoDb } from '../src/config/dynamoDb.js';

const token = randomBytes(32).toString('hex');
const tokenHash = createHash('sha256').update(token).digest('hex');
const now = Math.floor(Date.now() / 1000);

try {
  const userId = randomUUID();

  await saveSession({
    tokenHash,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 300
  });

  const saved = await findSession(tokenHash);
  assert.ok(saved);
  assert.equal(saved.userId, userId);
  assert.equal(saved.expiresAt, now + 300);
  assert.equal(Object.hasOwn(saved, 'token'), false);
  console.log('PASS: session saved and read without storing the raw token.');

  await assert.rejects(
    saveSession(saved),
    { name: 'ConditionalCheckFailedException' }
  );
  console.log('PASS: an existing session cannot be overwritten.');

  await deleteSession(tokenHash);
  assert.equal(await findSession(tokenHash), null);
  console.log('PASS: session deleted.');
} catch (error) {
  console.error('Session check failed:', error.name);
  process.exitCode = 1;
} finally {
  try {
    await deleteSession(tokenHash);
  } catch {
    console.error('Test session cleanup failed.');
    process.exitCode = 1;
  }
  dynamoDb.destroy();
}
