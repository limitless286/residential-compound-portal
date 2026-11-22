import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  hashPassword,
  verifyPassword
} from '../src/services/passwordService.js';

test('accepts the correct password and rejects a wrong password', async () => {
  const password = randomBytes(24).toString('hex');
  const hash = await hashPassword(password);

  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password + 'wrong', hash), false);
});

test('uses a different salt for the same password', async () => {
  const password = randomBytes(24).toString('hex');
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.notEqual(firstHash, secondHash);
  assert.equal(await verifyPassword(password, firstHash), true);
  assert.equal(await verifyPassword(password, secondHash), true);
});

test('rejects invalid password lengths and malformed hashes', async () => {
  await assert.rejects(hashPassword('short'));
  await assert.rejects(hashPassword('x'.repeat(129)));

  assert.equal(await verifyPassword('ValidTestPassword123!', 'invalid'), false);
  assert.equal(await verifyPassword(null, 'invalid'), false);
});
