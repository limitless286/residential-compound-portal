function toIso(value) {
  return new Date(value).toISOString();
}

export async function findUnnotifiedOverdue(
  database,
  { asOf, windowStart, limit }
) {
  const result = await database.query(
    `SELECT r.id, r.due_at
     FROM maintenance.requests r
     WHERE r.status IN ('OPEN', 'IN_PROGRESS')
       AND r.due_at < $1::timestamptz
       AND NOT EXISTS (
         SELECT 1
         FROM maintenance.overdue_notifications n
         WHERE n.request_id = r.id
           AND n.due_at = r.due_at
           AND n.window_start = $2::timestamptz
       )
     ORDER BY r.due_at ASC, r.id ASC
     LIMIT $3`,
    [asOf, windowStart, limit]
  );

  return result.rows.map(row => ({
    requestId: row.id,
    dueAt: toIso(row.due_at)
  }));
}

export async function recordOverdueNotification(database, job) {
  // Recheck the current request before writing. A resolved request or a
  // changed deadline makes the queued job obsolete.
  //
  // The unique constraint handles simultaneous deliveries and retries.
  const result = await database.query(
    `INSERT INTO maintenance.overdue_notifications (
       request_id, due_at, window_start, priority
     )
     SELECT r.id, r.due_at, $3::timestamptz, r.priority
     FROM maintenance.requests r
     WHERE r.id = $1::uuid
       AND r.due_at = $2::timestamptz
       AND r.status IN ('OPEN', 'IN_PROGRESS')
       AND r.due_at < CURRENT_TIMESTAMP
       AND $3::timestamptz <= CURRENT_TIMESTAMP
     ON CONFLICT (request_id, due_at, window_start) DO NOTHING
     RETURNING id`,
    [job.requestId, job.dueAt, job.windowStart]
  );

  return {
    created: result.rows.length === 1,
    notificationId: result.rows[0]?.id ?? null
  };
}

export async function listOverdueNotifications(database, { limit }) {
  const result = await database.query(
    `SELECT
       n.id,
       n.request_id,
       n.due_at,
       n.priority,
       n.created_at,
       r.title,
       r.status AS request_status
     FROM maintenance.overdue_notifications n
     JOIN maintenance.requests r ON r.id = n.request_id
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    requestId: row.request_id,
    title: row.title,
    priority: row.priority,
    dueAt: toIso(row.due_at),
    createdAt: toIso(row.created_at),
    requestStatus: row.request_status
  }));
}
