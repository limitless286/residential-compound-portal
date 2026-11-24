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

export { selectBookingPolicy };
