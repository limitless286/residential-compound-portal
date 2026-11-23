import { database } from '../config/database.js';

export async function insertBuilding({ code, name }) {
  const result = await database.query(
    `INSERT INTO identity.buildings (code, name)
     VALUES ($1, $2)
     RETURNING
       id, code, name,
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [code, name]
  );

  return result.rows[0];
}

export async function selectBuildings({ limit, offset }) {
  const result = await database.query(
    `SELECT
       id, code, name,
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM identity.buildings
     ORDER BY code ASC, id ASC
     LIMIT $1 OFFSET $2`,
    [limit + 1, offset]
  );

  return {
    buildings: result.rows.slice(0, limit),
    pagination: {
      limit,
      offset,
      hasMore: result.rows.length > limit
    }
  };
}
