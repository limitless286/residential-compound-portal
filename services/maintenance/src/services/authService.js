import { randomBytes, createHash } from 'node:crypto';
import { findUserForLogin } from '../repositories/userRepository.js';
import { saveSession } from '../repositories/sessionRepository.js';
import { hashPassword, verifyPassword } from './passwordService.js';

const SESSION_ABSOLUTE_SECONDS = 8 * 60 * 60;
let dummyHashPromise;

function authError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function loginUser(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof body.login !== 'string' ||
    typeof body.password !== 'string' ||
    body.login.trim().length === 0 ||
    body.login.length > 254 ||
    body.password.length === 0 ||
    body.password.length > 128 ||
    Object.keys(body).some((key) => !['login', 'password'].includes(key))
  ) {
    throw authError(400, 'INVALID_INPUT', 'Provide a valid login and password.');
  }

  const demoEnabled =
    process.env.DEMO_SEED_ENABLED === 'true' &&
    process.env.NODE_ENV !== 'production';

  const aliases = {
    admin: 'admin@example.com',
    resident: 'resident@example.com',
    resident2: 'resident2@example.com'
  };

  let email = body.login.trim().toLowerCase();

  if (demoEnabled && Object.hasOwn(aliases, email)) {
    email = aliases[email];
  }

  if (!demoEnabled && body.password.length < 12) {
    throw authError(401, 'INVALID_CREDENTIALS', 'Invalid login or password.');
  }

  try {
    const user = await findUserForLogin(email);

    if (!dummyHashPromise) {
      dummyHashPromise = hashPassword(randomBytes(24).toString('hex'))
        .catch((error) => {
          dummyHashPromise = undefined;
          throw error;
        });
    }

    const storedHash = user?.passwordHash || await dummyHashPromise;
    const passwordMatches = await verifyPassword(body.password, storedHash);

    if (
      !user ||
      !passwordMatches ||
      user.status !== 'ACTIVE' ||
      (user.role === 'RESIDENT' && user.unitStatus !== 'ACTIVE')
    ) {
      throw authError(401, 'INVALID_CREDENTIALS', 'Invalid login or password.');
    }

    const accessToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256')
      .update(accessToken)
      .digest('hex');

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_ABSOLUTE_SECONDS;

    await saveSession({
      tokenHash,
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        unitId: user.unitId,
        buildingId: user.buildingId
      }
    };
  } catch (error) {
    if (error.status) {
      throw error;
    }

    throw authError(
      503,
      'AUTH_UNAVAILABLE',
      'Authentication is temporarily unavailable.'
    );
  }
}
