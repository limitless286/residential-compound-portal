import {
  randomBytes,
  scrypt,
  timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);

const SCRYPT_OPTIONS = Object.freeze({
  N: 32768,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024
});

// Keep these parameters unchanged for scrypt-v1 hashes.
const HASH_VERSION = 'scrypt-v1';
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export async function hashPassword(password, { demoOnly = false } = {}) {
  if (
    demoOnly &&
    (
      process.env.DEMO_SEED_ENABLED !== 'true' ||
      process.env.NODE_ENV === 'production'
    )
  ) {
    throw new Error('Short demo passwords are disabled.');
  }

  const minimumLength = demoOnly ? 1 : MIN_PASSWORD_LENGTH;
  if (
    typeof password !== 'string' ||
    password.length < minimumLength ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new Error('Password must contain between 12 and 128 characters.');
  }

  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(
    password,
    salt,
    KEY_LENGTH,
    SCRYPT_OPTIONS
  );

  return [
    HASH_VERSION,
    salt.toString('hex'),
    key.toString('hex')
  ].join('$');
}

export async function verifyPassword(password, storedHash) {
  if (
    typeof password !== 'string' ||
    password.length < 1 ||
    password.length > MAX_PASSWORD_LENGTH ||
    typeof storedHash !== 'string'
  ) {
    return false;
  }

  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(
    storedHash
  );

  if (!match) {
    return false;
  }

  const salt = Buffer.from(match[1], 'hex');
  const expectedKey = Buffer.from(match[2], 'hex');

  const actualKey = await deriveKey(
    password,
    salt,
    KEY_LENGTH,
    SCRYPT_OPTIONS
  );

  return timingSafeEqual(actualKey, expectedKey);
}

