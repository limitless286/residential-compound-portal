// Effective status is derived from the stored approval and the publication
// window at read time, so SCHEDULED -> PUBLISHED -> EXPIRED happens without
// any background job.
const EFFECTIVE_STATUS = `CASE
    WHEN a.status = 'DRAFT' THEN 'DRAFT'
    WHEN a.expires_at IS NOT NULL AND a.expires_at <= CURRENT_TIMESTAMP
      THEN 'EXPIRED'
    WHEN a.publish_at > CURRENT_TIMESTAMP THEN 'SCHEDULED'
    ELSE 'PUBLISHED'
  END`;

const ADMIN_COLUMNS = `
  a.id,
  a.title,
  a.body,
  a.audience_type AS "audienceType",
  a.building_id AS "buildingId",
  ${EFFECTIVE_STATUS} AS "status",
  a.publish_at AS "publishAt",
  a.expires_at AS "expiresAt",
  a.created_by AS "createdBy",
  a.approved_by AS "approvedBy",
  a.maintenance_request_id AS "maintenanceRequestId",
  a.created_at AS "createdAt",
  a.updated_at AS "updatedAt",
  (SELECT COUNT(*)::INTEGER
   FROM community.announcement_reads r
   WHERE r.announcement_id = a.id) AS "readCount"
`;

// $1 = resident user id, $2 = resident building id (may be NULL).
const RESIDENT_COLUMNS = `
  a.id,
  a.title,
  a.body,
  a.audience_type AS "audienceType",
  a.building_id AS "buildingId",
  'PUBLISHED' AS "status",
  a.publish_at AS "publishAt",
  a.expires_at AS "expiresAt",
  EXISTS (
    SELECT 1 FROM community.announcement_reads r
    WHERE r.announcement_id = a.id AND r.user_id = $1
  ) AS "isRead"
`;

// Approved, inside its publication window, and addressed to everyone or to
// the resident's current building. A NULL building never matches BUILDING.
const VISIBLE_TO_RESIDENT = `
  a.status <> 'DRAFT'
  AND a.approved_by IS NOT NULL
  AND a.publish_at <= CURRENT_TIMESTAMP
  AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP)
  AND (
    a.audience_type = 'ALL'
    OR (a.audience_type = 'BUILDING' AND a.building_id = $2::UUID)
  )
`;

export async function insertAnnouncement(db, announcement) {
  const result = await db.query(
    `INSERT INTO community.announcements AS a
       (title, body, audience_type, building_id, status, publish_at,
        expires_at, created_by, maintenance_request_id)
     VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8)
     RETURNING ${ADMIN_COLUMNS}`,
    [
      announcement.title,
      announcement.body,
      announcement.audienceType,
      announcement.buildingId,
      announcement.publishAt ?? null,
      announcement.expiresAt ?? null,
      announcement.createdBy,
      announcement.maintenanceRequestId ?? null
    ]
  );

  return result.rows[0];
}

// Row lock for edits and approval, so two admins cannot change the same
// announcement at once. Returns the stored (not effective) status.
export async function lockAnnouncement(client, announcementId) {
  const result = await client.query(
    `SELECT
       id,
       title,
       body,
       audience_type AS "audienceType",
       building_id AS "buildingId",
       status AS "storedStatus",
       publish_at AS "publishAt",
       expires_at AS "expiresAt",
       approved_by AS "approvedBy"
     FROM community.announcements
     WHERE id = $1
     FOR UPDATE`,
    [announcementId]
  );

  return result.rows[0] ?? null;
}

export async function updateAnnouncement(client, announcementId, fields) {
  const result = await client.query(
    `UPDATE community.announcements AS a SET
       title = $2,
       body = $3,
       audience_type = $4,
       building_id = $5,
       status = $6,
       publish_at = $7,
       expires_at = $8,
       approved_by = $9,
       updated_at = CURRENT_TIMESTAMP
     WHERE a.id = $1
     RETURNING ${ADMIN_COLUMNS}`,
    [
      announcementId,
      fields.title,
      fields.body,
      fields.audienceType,
      fields.buildingId,
      fields.storedStatus,
      fields.publishAt,
      fields.expiresAt,
      fields.approvedBy
    ]
  );

  return result.rows[0];
}

export async function selectAnnouncementsForAdmin(db, {
  status,
  audienceType,
  buildingId,
  limit,
  offset
}) {
  const conditions = [];
  const values = [];

  function addCondition(sql, value) {
    values.push(value);
    conditions.push(sql.replace('?', '$' + values.length));
  }

  if (status) addCondition(`${EFFECTIVE_STATUS} = ?`, status);
  if (audienceType) addCondition('a.audience_type = ?', audienceType);
  if (buildingId) addCondition('a.building_id = ?', buildingId);

  values.push(limit + 1, offset);

  const result = await db.query(
    `SELECT ${ADMIN_COLUMNS}
     FROM community.announcements a
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY a.created_at DESC, a.id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    announcements: result.rows.slice(0, limit),
    hasMore: result.rows.length > limit
  };
}

export async function selectAnnouncementForAdmin(db, announcementId) {
  const result = await db.query(
    `SELECT ${ADMIN_COLUMNS}
     FROM community.announcements a
     WHERE a.id = $1`,
    [announcementId]
  );

  return result.rows[0] ?? null;
}

export async function selectVisibleAnnouncements(db, {
  userId,
  buildingId,
  limit,
  offset
}) {
  const result = await db.query(
    `SELECT ${RESIDENT_COLUMNS}
     FROM community.announcements a
     WHERE ${VISIBLE_TO_RESIDENT}
     ORDER BY a.publish_at DESC, a.id
     LIMIT $3 OFFSET $4`,
    [userId, buildingId ?? null, limit + 1, offset]
  );

  return {
    announcements: result.rows.slice(0, limit),
    hasMore: result.rows.length > limit
  };
}

export async function selectVisibleAnnouncement(db, {
  userId,
  buildingId,
  announcementId
}) {
  const result = await db.query(
    `SELECT ${RESIDENT_COLUMNS}
     FROM community.announcements a
     WHERE a.id = $3 AND ${VISIBLE_TO_RESIDENT}`,
    [userId, buildingId ?? null, announcementId]
  );

  return result.rows[0] ?? null;
}

// Eligibility check and insert happen in one statement. Returns
// { eligible, readAt, firstRead }.
export async function insertReadReceipt(db, {
  userId,
  buildingId,
  announcementId
}) {
  // Statement 1: insert the receipt if the announcement is visible.
  const result = await db.query(
    `WITH eligible AS (
       SELECT a.id
       FROM community.announcements a
       WHERE a.id = $3 AND ${VISIBLE_TO_RESIDENT}
     ),
     inserted AS (
       INSERT INTO community.announcement_reads (announcement_id, user_id)
       SELECT id, $1 FROM eligible
       ON CONFLICT (announcement_id, user_id) DO NOTHING
       RETURNING read_at
     )
     SELECT
       (SELECT COUNT(*) FROM eligible)::INTEGER AS "eligibleCount",
       (SELECT read_at FROM inserted) AS "insertedAt"`,
    [userId, buildingId ?? null, announcementId]
  );

  const row = result.rows[0];

  if (row.eligibleCount === 0) {
    return { eligible: false, readAt: null, firstRead: false };
  }

  if (row.insertedAt !== null) {
    return { eligible: true, readAt: row.insertedAt, firstRead: true };
  }

  // Statement 2: the receipt already exists. A separate statement is
  // required: when a concurrent first read committed while statement 1
  // waited on the conflict, statement 1's snapshot cannot see that row,
  // but a new statement under READ COMMITTED can. Receipts are never
  // updated or deleted, so this returns the original read_at.
  const existing = await db.query(
    `SELECT read_at AS "readAt"
     FROM community.announcement_reads
     WHERE announcement_id = $2 AND user_id = $1`,
    [userId, announcementId]
  );

  if (existing.rowCount === 0 || existing.rows[0].readAt === null) {
    // Should be impossible; fail rather than report a null readAt.
    throw new Error('Read receipt conflicted but could not be read back.');
  }

  return { eligible: true, readAt: existing.rows[0].readAt, firstRead: false };
}

export async function selectReadReceipts(db, announcementId) {
  const result = await db.query(
    `SELECT user_id AS "userId", read_at AS "readAt"
     FROM community.announcement_reads
     WHERE announcement_id = $1
     ORDER BY read_at, user_id`,
    [announcementId]
  );

  return result.rows;
}
