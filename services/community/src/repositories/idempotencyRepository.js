function scopeParameters(scope) {
  return [
    scope.callerService,
    scope.userId,
    scope.endpoint,
    scope.idempotencyKey
  ];
}

// Serializes concurrent requests that share one idempotency scope.
// The lock is released automatically when the transaction ends.
export async function lockIdempotencyScope(client, scope) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [scopeParameters(scope).join('|')]
  );
}

export async function selectIdempotencyRecord(db, scope) {
  const result = await db.query(
    `SELECT
       request_fingerprint AS "fingerprint",
       response_status AS "status",
       response_body AS "body"
     FROM community.idempotency_records
     WHERE caller_service = $1
       AND user_id = $2
       AND endpoint = $3
       AND idempotency_key = $4`,
    scopeParameters(scope)
  );

  return result.rows[0] ?? null;
}

export async function insertIdempotencyRecord(client, scope, record) {
  await client.query(
    `INSERT INTO community.idempotency_records
       (caller_service, user_id, endpoint, idempotency_key,
        request_fingerprint, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ...scopeParameters(scope),
      record.fingerprint,
      record.status,
      JSON.stringify(record.body)
    ]
  );
}
