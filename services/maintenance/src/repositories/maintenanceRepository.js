import { database } from '../config/database.js';
import { httpError } from '../utils/httpError.js';

function mapRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    unitId: row.unit_id,
    facilityId: row.facility_id,
    title: row.title,
    description: row.description,
    category: row.category,
    locationDescription: row.location_description,
    priority: row.priority,
    status: row.status,
    dueAt: row.due_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createMaintenanceRequest({
  userId,
  unitId,
  title,
  description,
  category,
  locationDescription,
  facilityId
}) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const duplicates = await client.query(
      `SELECT id, title, status, created_at
       FROM maintenance.requests
       WHERE user_id = $1
         AND unit_id = $2
         AND category = $3
         AND facility_id IS NOT DISTINCT FROM $4::uuid
         AND lower(trim(location_description)) = lower($5)
         AND status IN ('OPEN', 'IN_PROGRESS')
       ORDER BY created_at DESC, id DESC
       LIMIT 5`,
      [userId, unitId, category, facilityId, locationDescription]
    );

    const result = await client.query(
      `INSERT INTO maintenance.requests (
         user_id,
         unit_id,
         facility_id,
         title,
         description,
         category,
         location_description,
         priority,
         status,
         due_at
       )
       SELECT
         $1, $2, $3, $4, $5, $6, $7,
         policy.priority,
         'OPEN',
         CURRENT_TIMESTAMP
           + policy.resolution_hours * INTERVAL '1 hour'
       FROM maintenance.priority_policies AS policy
       WHERE policy.priority = 'MEDIUM'
       RETURNING *`,
      [
        userId,
        unitId,
        facilityId,
        title,
        description,
        category,
        locationDescription
      ]
    );

    if (result.rowCount !== 1) {
      throw httpError(
        503,
        'MAINTENANCE_POLICY_UNAVAILABLE',
        'Maintenance priority configuration is unavailable.'
      );
    }

    const request = mapRequest(result.rows[0]);

    await client.query(
      `INSERT INTO maintenance.request_history (
         request_id,
         actor_user_id,
         event_type,
         previous_status,
         next_status
       )
       VALUES ($1, $2, 'CREATED', NULL, 'OPEN')`,
      [request.id, userId]
    );

    await client.query('COMMIT');

    return {
      request,
      possibleDuplicates: duplicates.rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        createdAt: row.created_at
      }))
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listMaintenanceRequests({
  userId,
  isAdmin,
  status,
  priority,
  limit,
  offset
}) {
  const result = await database.query(
    `SELECT *
     FROM maintenance.requests
     WHERE ($1::boolean OR user_id = $2::uuid)
       AND ($3::text IS NULL OR status = $3)
       AND ($4::text IS NULL OR priority = $4)
     ORDER BY created_at DESC, id DESC
     LIMIT $5 OFFSET $6`,
    [isAdmin, userId, status, priority, limit + 1, offset]
  );

  return {
    requests: result.rows.slice(0, limit).map(mapRequest),
    pagination: {
      limit,
      offset,
      hasMore: result.rows.length > limit
    }
  };
}

export async function findMaintenanceRequestById(id) {
  const result = await database.query(
    'SELECT * FROM maintenance.requests WHERE id = $1',
    [id]
  );

  return result.rows[0] ? mapRequest(result.rows[0]) : null;
}

export async function findMaintenanceRequestHistory(requestId) {
  const result = await database.query(
    `SELECT
       id,
       actor_user_id AS "actorUserId",
       event_type AS "eventType",
       previous_status AS "previousStatus",
       next_status AS "nextStatus",
       reason,
       created_at AS "createdAt"
     FROM maintenance.request_history
     WHERE request_id = $1
     ORDER BY created_at ASC, id ASC`,
    [requestId]
  );

  return result.rows;
}

export async function transitionMaintenanceRequest({
  id,
  actorUserId,
  expectedStatus,
  nextStatus,
  eventType,
  reason,
  ownerUserId = null
}) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT *
       FROM maintenance.requests
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (current.rowCount === 0) {
      throw httpError(
        404,
        'REQUEST_NOT_FOUND',
        'Maintenance request not found.'
      );
    }

    if (ownerUserId !== null &&
        current.rows[0].user_id !== ownerUserId) {
      throw httpError(
        403,
        'FORBIDDEN',
        "You cannot change another resident's request."
      );
    }

    if (current.rows[0].status !== expectedStatus) {
      throw httpError(
        409,
        'INVALID_STATUS_TRANSITION',
        `This action requires status ${expectedStatus}.`
      );
    }

    const updated = await client.query(
      `UPDATE maintenance.requests
       SET status = $2::varchar,
           resolved_at = CASE
             WHEN $2::varchar = 'RESOLVED' THEN clock_timestamp()
             ELSE resolved_at
           END,
           closed_at = CASE
             WHEN $2::varchar = 'CLOSED' THEN clock_timestamp()
             ELSE closed_at
           END,
           updated_at = clock_timestamp()
       WHERE id = $1
       RETURNING *`,
      [id, nextStatus]
    );

    await client.query(
      `INSERT INTO maintenance.request_history (
         request_id,
         actor_user_id,
         event_type,
         previous_status,
         next_status,
         reason
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        actorUserId,
        eventType,
        expectedStatus,
        nextStatus,
        reason
      ]
    );

    await client.query('COMMIT');

    return mapRequest(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}



export async function reopenMaintenanceRequest({
  id,
  userId,
  reason,
  reopenWindowHours
}) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT *
       FROM maintenance.requests
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (current.rowCount === 0) {
      throw httpError(
        404,
        'REQUEST_NOT_FOUND',
        'Maintenance request not found.'
      );
    }

    const row = current.rows[0];

    if (row.user_id !== userId) {
      throw httpError(
        403,
        'FORBIDDEN',
        'You cannot reopen another resident’s request.'
      );
    }

    if (row.status !== 'RESOLVED') {
      throw httpError(
        409,
        'INVALID_STATUS_TRANSITION',
        'Only a resolved request can be reopened.'
      );
    }

    const timing = await client.query(
      `SELECT
         clock_timestamp() AS checked_at,
         resolved_at + ($2::integer * INTERVAL '1 hour') AS deadline
       FROM maintenance.requests
       WHERE id = $1`,
      [id, reopenWindowHours]
    );

    const { checked_at: checkedAt, deadline } = timing.rows[0];

    if (!deadline || checkedAt.getTime() > deadline.getTime()) {
      throw httpError(
        409,
        'REOPEN_WINDOW_EXPIRED',
        'The reopening window has expired.'
      );
    }

    const updated = await client.query(
      `UPDATE maintenance.requests AS request
       SET status = 'OPEN',
           resolved_at = NULL,
           closed_at = NULL,
           due_at = clock_timestamp()
             + policy.resolution_hours * INTERVAL '1 hour',
           updated_at = clock_timestamp()
       FROM maintenance.priority_policies AS policy
       WHERE request.id = $1
         AND policy.priority = request.priority
       RETURNING request.*`,
      [id]
    );

    if (updated.rowCount !== 1) {
      throw httpError(
        503,
        'MAINTENANCE_POLICY_UNAVAILABLE',
        'Maintenance priority configuration is unavailable.'
      );
    }

    await client.query(
      `INSERT INTO maintenance.request_history (
         request_id,
         actor_user_id,
         event_type,
         previous_status,
         next_status,
         reason
       )
       VALUES ($1, $2, 'REOPENED', 'RESOLVED', 'OPEN', $3)`,
      [id, userId, reason]
    );

    await client.query('COMMIT');

    return mapRequest(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function updateMaintenancePriority({
  id,
  actorUserId,
  priority,
  reason
}) {
  const client = await database.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT *
       FROM maintenance.requests
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (current.rowCount === 0) {
      throw httpError(
        404,
        'REQUEST_NOT_FOUND',
        'Maintenance request not found.'
      );
    }

    const row = current.rows[0];

    if (!['OPEN', 'IN_PROGRESS'].includes(row.status)) {
      throw httpError(
        409,
        'INVALID_STATUS_TRANSITION',
        'Priority can change only for open or in-progress requests.'
      );
    }

    if (row.priority === priority) {
      throw httpError(
        409,
        'PRIORITY_UNCHANGED',
        'The request already has this priority.'
      );
    }

    const updated = await client.query(
      `UPDATE maintenance.requests AS request
       SET priority = policy.priority,
           due_at = COALESCE(
             (
               SELECT MAX(history.created_at)
               FROM maintenance.request_history AS history
               WHERE history.request_id = request.id
                 AND history.event_type = 'REOPENED'
             ),
             request.created_at
           ) + policy.resolution_hours * INTERVAL '1 hour',
           updated_at = clock_timestamp()
       FROM maintenance.priority_policies AS policy
       WHERE request.id = $1
         AND policy.priority = $2::varchar
       RETURNING request.*`,
      [id, priority]
    );

    if (updated.rowCount !== 1) {
      throw httpError(
        503,
        'MAINTENANCE_POLICY_UNAVAILABLE',
        'Maintenance priority configuration is unavailable.'
      );
    }

    await client.query(
      `INSERT INTO maintenance.request_history (
         request_id,
         actor_user_id,
         event_type,
         previous_status,
         next_status,
         reason
       )
       VALUES ($1, $2, 'PRIORITY_CHANGED', $3, $3, $4)`,
      [
        id,
        actorUserId,
        row.status,
        `Priority changed from ${row.priority} to ${priority}. ${reason}`
      ]
    );

    await client.query('COMMIT');

    return mapRequest(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
