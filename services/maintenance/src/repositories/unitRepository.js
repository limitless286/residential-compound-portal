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
