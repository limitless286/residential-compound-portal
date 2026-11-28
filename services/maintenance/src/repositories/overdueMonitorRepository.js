import { withMonitorTransaction } from '../utils/monitorTransaction.js';

function toIso(value) {
  return new Date(value).toISOString();
}

export async function findUnnotifiedOverdue(
  database,
  { asOf, windowStart, limit, repeatAfterHours }
) {
  const result = await database.query(
    `SELECT r.id,
       to_char(r.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS due_at
     FROM maintenance.requests r
     WHERE r.status IN ('OPEN', 'IN_PROGRESS')
       AND r.due_at < $1::timestamptz
       AND NOT EXISTS (
         SELECT 1
         FROM maintenance.overdue_notifications n
         WHERE n.request_id = r.id
           AND n.due_at = r.due_at
           AND (n.window_start = $2::timestamptz
                OR n.created_at > $1::timestamptz - make_interval(hours => $4::integer))
       )
     ORDER BY r.due_at ASC, r.id ASC
     LIMIT $3`,
    [asOf, windowStart, limit, repeatAfterHours]
  );

  return result.rows.map(row => ({
    requestId: row.id,
    dueAt: row.due_at
  }));
}

export async function recordOverdueNotification(database, job) {
  return withMonitorTransaction(database, async client => {
    // Serialize alerts with each other and with the normal request workflow.
    const request = await client.query(
      `SELECT id FROM maintenance.requests
       WHERE id = $1::uuid AND due_at = $2::timestamptz
         AND status IN ('OPEN', 'IN_PROGRESS')
         AND due_at < CURRENT_TIMESTAMP
         AND $3::timestamptz <= CURRENT_TIMESTAMP
       FOR UPDATE`,
      [job.requestId, job.dueAt, job.windowStart]
    );
    if (!request.rowCount) return { created: false, notificationId: null };

    // A separate statement sees any notification committed while waiting for
    // the row lock. Cooldown applies across calendar/window boundaries too.
    const recent = await client.query(
      `SELECT id FROM maintenance.overdue_notifications
       WHERE request_id = $1::uuid AND due_at = $2::timestamptz
         AND created_at > statement_timestamp() - make_interval(hours => $3::integer)
       LIMIT 1`,
      [job.requestId, job.dueAt, job.repeatAfterHours]
    );
    if (recent.rowCount) return { created: false, notificationId: null };

    const result = await client.query(
      `INSERT INTO maintenance.overdue_notifications (
         request_id, due_at, window_start, priority
       )
       SELECT r.id, r.due_at, $3::timestamptz, r.priority
       FROM maintenance.requests r WHERE r.id = $1::uuid
         AND r.due_at = $2::timestamptz
       ON CONFLICT (request_id, due_at, window_start) DO NOTHING
       RETURNING id`,
      [job.requestId, job.dueAt, job.windowStart]
    );
    return {
      created: result.rowCount === 1,
      notificationId: result.rows[0]?.id ?? null
    };
  });
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
