const FACILITY_COLUMNS = `
    id,
    name,
    description,
    location_description AS "locationDescription",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
`;

const SELECT_FACILITY_BY_ID_SQL = `
  SELECT${FACILITY_COLUMNS}  FROM bookings.facilities
  WHERE id = $1::uuid
`;

// Every function takes db (a pg Pool or a transaction client) first and
// never begins, commits or rolls back anything.

export async function selectFacilities(db, { onlyActive } = {}) {
  const result = await db.query(
    `
  SELECT${FACILITY_COLUMNS}  FROM bookings.facilities
  WHERE ($1::boolean = FALSE OR status = 'ACTIVE')
  ORDER BY name ASC, id ASC
`,
    [onlyActive === true]
  );
  return result.rows;
}

export async function selectFacilityById(db, facilityId) {
  const result = await db.query(SELECT_FACILITY_BY_ID_SQL, [facilityId]);
  return result.rows[0] ?? null;
}

// Lock level (b) in docs/booking-locking-protocol.md.
// Call only inside withTransaction.
export async function selectFacilityByIdForUpdate(db, facilityId) {
  const result = await db.query(`${SELECT_FACILITY_BY_ID_SQL}  FOR UPDATE\n`, [facilityId]);
  return result.rows[0] ?? null;
}

export async function selectOpeningHours(db, facilityId) {
  const result = await db.query(
    `
  SELECT
    day_of_week AS "dayOfWeek",
    to_char(opens_at, 'HH24:MI') AS "opensAt",
    to_char(closes_at, 'HH24:MI') AS "closesAt"
  FROM bookings.opening_hours
  WHERE facility_id = $1::uuid
  ORDER BY day_of_week ASC
`,
    [facilityId]
  );
  return result.rows;
}
