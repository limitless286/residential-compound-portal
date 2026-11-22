import { createHash } from 'node:crypto';
import {
  refreshActiveSession,
  deleteSession
} from '../repositories/sessionRepository.js';
import { findUserById } from '../repositories/userRepository.js';

const SESSION_IDLE_SECONDS = 30 * 60;

function authError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function authenticateToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw authError(401, 'UNAUTHORIZED', 'A valid session is required.');
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = Math.floor(Date.now() / 1000);

  try {
    const session = await refreshActiveSession(
      tokenHash,
      now,
      now - SESSION_IDLE_SECONDS
    );

    if (!session) {
      throw authError(401, 'UNAUTHORIZED', 'A valid session is required.');
    }

    const user = await findUserById(session.userId);

    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !['ADMIN', 'RESIDENT'].includes(user.role) ||
      (
        user.role === 'RESIDENT' &&
        (!user.unitId || user.unitStatus !== 'ACTIVE')
      )
    ) {
      throw authError(401, 'UNAUTHORIZED', 'A valid session is required.');
    }

    return {
      tokenHash,
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

export async function logoutSession(tokenHash) {
  try {
    await deleteSession(tokenHash);
  } catch {
    throw authError(
      503,
      'AUTH_UNAVAILABLE',
      'Logout is temporarily unavailable.'
    );
  }
}
