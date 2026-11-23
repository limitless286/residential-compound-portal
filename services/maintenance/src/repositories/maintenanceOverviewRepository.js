import { database } from '../config/database.js';

export async function getMaintenanceOverview() {
  const result = await database.query(
    `WITH stats AS (
       SELECT
         COUNT(*)::integer AS total,
         COUNT(*) FILTER (
           WHERE status = 'OPEN'
         )::integer AS open_count,
         COUNT(*) FILTER (
           WHERE status = 'IN_PROGRESS'
         )::integer AS in_progress_count,
         COUNT(*) FILTER (
           WHERE status = 'RESOLVED'
         )::integer AS resolved_count,
         COUNT(*) FILTER (
           WHERE status = 'CLOSED'
         )::integer AS closed_count,
         COUNT(*) FILTER (
           WHERE status IN ('OPEN', 'IN_PROGRESS')
             AND priority = 'HIGH'
         )::integer AS high_count,
         COUNT(*) FILTER (
           WHERE status IN ('OPEN', 'IN_PROGRESS')
             AND priority = 'MEDIUM'
         )::integer AS medium_count,
         COUNT(*) FILTER (
           WHERE status IN ('OPEN', 'IN_PROGRESS')
             AND priority = 'LOW'
         )::integer AS low_count,
         COUNT(*) FILTER (
           WHERE status IN ('OPEN', 'IN_PROGRESS')
             AND due_at < statement_timestamp()
         )::integer AS overdue_count
       FROM maintenance.requests
     ),
     overdue AS (
       SELECT id, title, status, priority, due_at
       FROM maintenance.requests
       WHERE status IN ('OPEN', 'IN_PROGRESS')
         AND due_at < statement_timestamp()
       ORDER BY due_at ASC, id ASC
       LIMIT 20
     )
     SELECT
       stats.*,
       statement_timestamp() AS as_of,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', id,
               'title', title,
               'status', status,
               'priority', priority,
               'dueAt', due_at,
               'overdueMinutes',
                 FLOOR(EXTRACT(
                   EPOCH FROM (statement_timestamp() - due_at)
                 ) / 60)::bigint
             )
             ORDER BY due_at ASC, id ASC
           )
           FROM overdue
         ),
         '[]'::json
       ) AS overdue_requests
     FROM stats`
  );

  const row = result.rows[0];

  return {
    asOf: row.as_of,
    total: row.total,
    byStatus: {
      OPEN: row.open_count,
      IN_PROGRESS: row.in_progress_count,
      RESOLVED: row.resolved_count,
      CLOSED: row.closed_count
    },
    activeByPriority: {
      HIGH: row.high_count,
      MEDIUM: row.medium_count,
      LOW: row.low_count
    },
    overdue: {
      count: row.overdue_count,
      limit: 20,
      hasMore: row.overdue_count > 20,
      requests: row.overdue_requests
    }
  };
}
