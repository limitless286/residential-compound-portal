import { database } from '../config/database.js';
import { httpError } from '../utils/httpError.js';

export async function insertResident({
  unitId,
  fullName,
  email,
  passwordHash
}) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const unitResult = await client.query(
      `SELECT id, building_id, status
       FROM identity.units
       WHERE id = $1
       FOR SHARE`,
      [unitId]
    );

    if (unitResult.rowCount === 0) {
      throw httpError(404, 'UNIT_NOT_FOUND', 'Unit not found.');
    }

    const unit = unitResult.rows[0];

    if (unit.status !== 'ACTIVE') {
      throw httpError(
        409,
        'UNIT_INACTIVE',
        'Residents must be assigned to an active unit.'
      );
    }

    const result = await client.query(
      `INSERT INTO identity.users (
         unit_id,
         full_name,
         email,
         password_hash,
         role,
         status
       )
       VALUES ($1, $2, $3, $4, 'RESIDENT', 'ACTIVE')
       RETURNING
         id,
         unit_id AS "unitId",
         full_name AS "fullName",
         email,
         role,
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [unitId, fullName, email, passwordHash]
    );

    await client.query('COMMIT');

    return {
      ...result.rows[0],
      buildingId: unit.building_id
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function selectResidents({ status, limit, offset }) {
  const result = await database.query(
    `SELECT
       resident.id,
       resident.full_name AS "fullName",
       resident.email,
       resident.role,
       resident.status,
       resident.unit_id AS "unitId",
       unit.unit_number AS "unitNumber",
       unit.building_id AS "buildingId",
       building.code AS "buildingCode",
       resident.created_at AS "createdAt",
       resident.updated_at AS "updatedAt"
     FROM identity.users AS resident
     JOIN identity.units AS unit ON unit.id = resident.unit_id
     JOIN identity.buildings AS building ON building.id = unit.building_id
     WHERE resident.role = 'RESIDENT'
       AND ($1::varchar IS NULL OR resident.status = $1::varchar)
     ORDER BY resident.created_at DESC, resident.id DESC
     LIMIT $2 OFFSET $3`,
    [status, limit + 1, offset]
  );

  return {
    residents: result.rows.slice(0, limit),
    pagination: {
      limit,
      offset,
      hasMore: result.rows.length > limit
    }
  };
}

export async function updateResidentStatus({ id, status }) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT id, unit_id, status
       FROM identity.users
       WHERE id = $1 AND role = 'RESIDENT'
       FOR UPDATE`,
      [id]
    );

    if (current.rowCount === 0) {
      throw httpError(404, 'RESIDENT_NOT_FOUND', 'Resident not found.');
    }

    if (status === 'ACTIVE') {
      const unit = await client.query(
        `SELECT status
         FROM identity.units
         WHERE id = $1
         FOR SHARE`,
        [current.rows[0].unit_id]
      );

      if (unit.rowCount === 0 || unit.rows[0].status !== 'ACTIVE') {
        throw httpError(
          409,
          'UNIT_INACTIVE',
          'The resident must belong to an active unit.'
        );
      }
    }

    const result = await client.query(
      `UPDATE identity.users
       SET status = $2::varchar,
           updated_at = CASE
             WHEN status <> $2::varchar THEN clock_timestamp()
             ELSE updated_at
           END
       WHERE id = $1 AND role = 'RESIDENT'
       RETURNING
         id,
         full_name AS "fullName",
         email,
         role,
         status,
         unit_id AS "unitId",
         updated_at AS "updatedAt"`,
      [id, status]
    );

    await client.query('COMMIT');

    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
