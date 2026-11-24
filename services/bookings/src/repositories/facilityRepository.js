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

// Creating a facility takes no lock (the row does not exist yet).
// Call only inside withTransaction.
export async function insertFacility(db, { name, description, locationDescription }) {
  const result = await db.query(
    `
  INSERT INTO bookings.facilities (name, description, location_description)
  VALUES ($1, $2, $3)
  RETURNING${FACILITY_COLUMNS}`,
    [name, description, locationDescription]
  );
  return result.rows[0];
}

// Call only inside withTransaction, after the facility lock (b).
export async function updateFacility(db, facilityId, changes = {}) {
  const result = await db.query(
    `
  UPDATE bookings.facilities
  SET name = COALESCE($2, name),
      description = COALESCE($3, description),
      location_description = COALESCE($4, location_description),
      status = COALESCE($5, status),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = $1::uuid
  RETURNING${FACILITY_COLUMNS}`,
    [
      facilityId,
      changes.name ?? null,
      changes.description ?? null,
      changes.locationDescription ?? null,
      changes.status ?? null
    ]
  );
  return result.rows[0] ?? null;
}

// Call only inside withTransaction, after the facility lock (b).
export async function deleteOpeningHours(db, facilityId) {
  const result = await db.query(
    'DELETE FROM bookings.opening_hours WHERE facility_id = $1::uuid',
    [facilityId]
  );
  return result.rowCount;
}

// Call only inside withTransaction, after the facility lock (b).
export async function insertOpeningHour(db, { facilityId, dayOfWeek, opensAt, closesAt }) {
  await db.query(
    `
  INSERT INTO bookings.opening_hours (facility_id, day_of_week, opens_at, closes_at)
  VALUES ($1::uuid, $2::smallint, $3::time, $4::time)
`,
    [facilityId, dayOfWeek, opensAt, closesAt]
  );
}
