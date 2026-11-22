import { database } from '../config/database.js';

const USER_SELECT = `
  SELECT
    u.id,
    u.email,
    u.full_name AS "fullName",
    u.password_hash AS "passwordHash",
    u.role,
    u.status,
    u.unit_id AS "unitId",
    un.status AS "unitStatus",
    un.building_id AS "buildingId"
  FROM identity.users u
  LEFT JOIN identity.units un ON un.id = u.unit_id
`;

export async function findUserForLogin(email) {
  const result = await database.query(
    USER_SELECT + ' WHERE u.email = $1',
    [email]
  );

  return result.rows[0] || null;
}

export async function findUserById(userId) {
  const result = await database.query(
    USER_SELECT + ' WHERE u.id = $1',
    [userId]
  );

  return result.rows[0] || null;
}
