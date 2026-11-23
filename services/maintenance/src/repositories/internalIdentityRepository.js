import { database } from '../config/database.js';

export async function selectActiveUnits({ afterId, limit }) {
  const result = await database.query(
    `SELECT
       id AS "unitId",
       building_id AS "buildingId",
       unit_number AS "unitNumber"
     FROM identity.units
     WHERE status = 'ACTIVE'
       AND ($1::uuid IS NULL OR id > $1::uuid)
     ORDER BY id ASC
     LIMIT $2`,
    [afterId, limit + 1]
  );

  return {
    units: result.rows.slice(0, limit),
    hasMore: result.rows.length > limit
  };
}

export async function findNotificationRecipient(userId) {
  const result = await database.query(
    `SELECT
       resident.id AS "userId",
       resident.email,
       resident.full_name AS "fullName"
     FROM identity.users AS resident
     JOIN identity.units AS unit ON unit.id = resident.unit_id
     WHERE resident.id = $1
       AND resident.role = 'RESIDENT'
       AND resident.status = 'ACTIVE'
       AND unit.status = 'ACTIVE'`,
    [userId]
  );

  return result.rows[0] ?? null;
}
