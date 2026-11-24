const POLICY_COLUMNS = `
  monthly_amount_minor AS "monthlyAmountMinor",
  currency,
  due_day AS "dueDay",
  updated_at AS "updatedAt"
`;

export async function selectFeePolicy(db) {
  const result = await db.query(
    `SELECT ${POLICY_COLUMNS}
     FROM community.fee_policies
     WHERE id = TRUE`
  );

  return result.rows[0] ?? null;
}

export async function upsertFeePolicy(db, { monthlyAmountMinor, currency, dueDay }) {
  const result = await db.query(
    `INSERT INTO community.fee_policies
       (id, monthly_amount_minor, currency, due_day, updated_at)
     VALUES (TRUE, $1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       monthly_amount_minor = EXCLUDED.monthly_amount_minor,
       currency = EXCLUDED.currency,
       due_day = EXCLUDED.due_day,
       updated_at = CURRENT_TIMESTAMP
     RETURNING ${POLICY_COLUMNS}`,
    [monthlyAmountMinor, currency, dueDay]
  );

  return result.rows[0];
}
