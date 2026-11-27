const SELECT_BOOKING_POLICY_SQL = `
  SELECT
    max_future_bookings_per_unit AS "maxFutureBookingsPerUnit",
    advance_days AS "advanceDays",
    cancellation_cutoff_minutes AS "cancellationCutoffMinutes",
    allowed_duration_minutes AS "allowedDurationMinutes"
  FROM bookings.booking_policies
  WHERE id = TRUE
`;

// Reads the single booking policy row. db is a pg Pool or a transaction
// client; this function never begins, commits or rolls back anything.
async function selectBookingPolicy(db) {
  const result = await db.query(SELECT_BOOKING_POLICY_SQL);
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('The booking policy row is missing.');
  }

  return Object.freeze({
    maxFutureBookingsPerUnit: row.maxFutureBookingsPerUnit,
    advanceDays: row.advanceDays,
    cancellationCutoffMinutes: row.cancellationCutoffMinutes,
    allowedDurationMinutes: Object.freeze([...row.allowedDurationMinutes])
  });
}

const UPDATE_BOOKING_POLICY_SQL = `
  UPDATE bookings.booking_policies
  SET max_future_bookings_per_unit = $1,
      advance_days = $2,
      cancellation_cutoff_minutes = $3,
      allowed_duration_minutes = $4::integer[],
      updated_at = CURRENT_TIMESTAMP
  WHERE id = TRUE
  RETURNING max_future_bookings_per_unit AS "maxFutureBookingsPerUnit",
            advance_days AS "advanceDays",
            cancellation_cutoff_minutes AS "cancellationCutoffMinutes",
            allowed_duration_minutes AS "allowedDurationMinutes"
`;

// Replaces the single booking policy row without validating it. The caller
// owns the transaction; this function never begins, commits or rolls back.
async function updateBookingPolicy(db, policy) {
  const result = await db.query(UPDATE_BOOKING_POLICY_SQL, [
    policy.maxFutureBookingsPerUnit,
    policy.advanceDays,
    policy.cancellationCutoffMinutes,
    policy.allowedDurationMinutes
  ]);
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error('The booking policy row is missing.');
  }

  return Object.freeze({
    maxFutureBookingsPerUnit: row.maxFutureBookingsPerUnit,
    advanceDays: row.advanceDays,
    cancellationCutoffMinutes: row.cancellationCutoffMinutes,
    allowedDurationMinutes: Object.freeze([...row.allowedDurationMinutes])
  });
}

export { selectBookingPolicy, updateBookingPolicy };
