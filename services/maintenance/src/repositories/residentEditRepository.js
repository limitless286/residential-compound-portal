import { database } from '../config/database.js';
import { httpError } from '../utils/httpError.js';

export async function updateResidentDetails({
  id,
  fullName,
  email,
  unitId
}) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT id
       FROM identity.users
       WHERE id = $1 AND role = 'RESIDENT'
       FOR UPDATE`,
      [id]
    );

    if (current.rowCount === 0) {
      throw httpError(404, 'RESIDENT_NOT_FOUND', 'Resident not found.');
    }

    if (unitId !== undefined) {
      const unit = await client.query(
        `SELECT status
         FROM identity.units
         WHERE id = $1
         FOR SHARE`,
        [unitId]
      );

      if (unit.rowCount === 0) {
        throw httpError(404, 'UNIT_NOT_FOUND', 'Unit not found.');
      }

      if (unit.rows[0].status !== 'ACTIVE') {
        throw httpError(
          409,
          'UNIT_INACTIVE',
          'The selected unit must be active.'
        );
      }
    }

    const result = await client.query(
      `UPDATE identity.users
       SET full_name = COALESCE($2::text, full_name),
           email = COALESCE($3::text, email),
           unit_id = COALESCE($4::uuid, unit_id),
           updated_at = clock_timestamp()
       WHERE id = $1 AND role = 'RESIDENT'
       RETURNING
         id,
         full_name AS "fullName",
         email,
         role,
         status,
         unit_id AS "unitId",
         updated_at AS "updatedAt"`,
      [
        id,
        fullName ?? null,
        email ?? null,
        unitId ?? null
      ]
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
