import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  saveSession,
  findSession,
  deleteSession,
  refreshActiveSession
} from '../src/repositories/sessionRepository.js';

import { dynamoDb } from '../src/config/dynamoDb.js';

const now = Math.floor(Date.now() / 1000);
const keys = [];

async function addTestSession(lastSeenAt, expiresAt) {
  const tokenHash = randomBytes(32).toString('hex');
  keys.push(tokenHash);

  await saveSession({
    tokenHash,
    userId: randomUUID(),
    createdAt: now - 3600,
    lastSeenAt,
    expiresAt
  });

  return tokenHash;
}

try {
  const active = await addTestSession(now - 60, now + 3600);
  const refreshed = await refreshActiveSession(active, now, now - 1800);
  assert.ok(refreshed);
  assert.equal(refreshed.lastSeenAt, now);
  console.log('PASS: active session accepted and activity updated.');

  const idle = await addTestSession(now - 1801, now + 3600);
  assert.equal(await refreshActiveSession(idle, now, now - 1800), null);
  console.log('PASS: idle session rejected before TTL deletion.');

  const expired = await addTestSession(now - 60, now);
  assert.equal(await refreshActiveSession(expired, now, now - 1800), null);
  console.log('PASS: expired session rejected.');

  await deleteSession(active);
  assert.equal(await refreshActiveSession(active, now, now - 1800), null);
  assert.equal(await findSession(active), null);
  console.log('PASS: deleted session cannot be recreated by an activity update.');
} catch (error) {
  console.error('Session expiry check failed:', error.name);
  process.exitCode = 1;
} finally {
  for (const key of keys) {
    try {
      await deleteSession(key);
    } catch {
      console.error('Test session cleanup failed.');
      process.exitCode = 1;
    }
  }

  dynamoDb.destroy();
}
