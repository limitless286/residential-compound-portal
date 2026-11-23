import { database } from '../config/database.js';

export async function insertUnit({ buildingId, unitNumber }) {
  const result = await database.query(
    `INSERT INTO identity.units (building_id, unit_number)
     SELECT id, $2
     FROM identity.buildings
     WHERE id = $1::uuid
     RETURNING
       id,
       building_id AS "buildingId",
       unit_number AS "unitNumber",
       status,
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [buildingId, unitNumber]
  );

  return result.rows[0] ?? null;
}

export async function selectUnits({
  buildingId,
  status,
  limit,
  offset
}) {
  const result = await database.query(
    `SELECT
       unit.id,
       unit.building_id AS "buildingId",
       building.code AS "buildingCode",
       unit.unit_number AS "unitNumber",
       unit.status,
       unit.created_at AS "createdAt",
       unit.updated_at AS "updatedAt"
     FROM identity.units AS unit
     JOIN identity.buildings AS building
       ON building.id = unit.building_id
     WHERE ($1::uuid IS NULL OR unit.building_id = $1::uuid)
       AND ($2::varchar IS NULL OR unit.status = $2::varchar)
     ORDER BY building.code ASC, unit.unit_number ASC, unit.id ASC
     LIMIT $3 OFFSET $4`,
    [buildingId, status, limit + 1, offset]
  );

  return {
    units: result.rows.slice(0, limit),
    pagination: {
      limit,
      offset,
      hasMore: result.rows.length > limit
    }
  };
}

export async function updateUnit({ id, unitNumber, status }) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT id
       FROM identity.units
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (current.rowCount === 0) {
      throw Object.assign(new Error('Unit not found.'), {
        status: 404,
        code: 'UNIT_NOT_FOUND'
      });
    }

    if (status === 'INACTIVE') {
      const residents = await client.query(
        `SELECT 1
         FROM identity.users
         WHERE unit_id = $1
           AND role = 'RESIDENT'
           AND status = 'ACTIVE'
         LIMIT 1`,
        [id]
      );

      if (residents.rowCount > 0) {
        throw Object.assign(
          new Error('Move or disable active residents before deactivating this unit.'),
          {
            status: 409,
            code: 'UNIT_HAS_ACTIVE_RESIDENTS'
          }
        );
      }
    }

    const result = await client.query(
      `UPDATE identity.units
       SET unit_number = COALESCE($2::text, unit_number),
           status = COALESCE($3::varchar, status),
           updated_at = clock_timestamp()
       WHERE id = $1
       RETURNING
         id,
         building_id AS "buildingId",
         unit_number AS "unitNumber",
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [id, unitNumber ?? null, status ?? null]
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
