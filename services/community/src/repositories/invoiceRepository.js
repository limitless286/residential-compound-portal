// Reads use the invoice_balances view so status, remaining balance and
// overdue state are always derived from stored invoices and payments.
const INVOICE_COLUMNS = `
  b.id,
  b.unit_id AS "unitId",
  to_char(b.billing_period, 'YYYY-MM') AS "billingPeriod",
  b.amount_minor AS "amountMinor",
  b.currency,
  to_char(b.due_date, 'YYYY-MM-DD') AS "dueDate",
  b.paid_amount_minor::INTEGER AS "paidAmountMinor",
  b.remaining_amount_minor::INTEGER AS "remainingAmountMinor",
  b.status,
  b.is_overdue AS "isOverdue",
  b.created_at AS "createdAt"
`;

// Returns the number of invoices actually created. Units that already
// have an invoice for the period are skipped by the unique constraint.
export async function insertInvoicesForUnits(client, {
  unitIds,
  periodStart,
  amountMinor,
  currency,
  dueDate,
  generatedBy
}) {
  const result = await client.query(
    `INSERT INTO community.invoices
       (unit_id, billing_period, amount_minor, currency, due_date, generated_by)
     SELECT units.unit_id, $2::DATE, $3, $4, $5::DATE, $6
     FROM unnest($1::UUID[]) AS units(unit_id)
     ON CONFLICT (unit_id, billing_period) DO NOTHING
     RETURNING id`,
    [unitIds, periodStart, amountMinor, currency, dueDate, generatedBy]
  );

  return result.rowCount;
}

export async function selectInvoices(db, {
  unitId,
  periodStart,
  status,
  overdue,
  limit,
  offset
}) {
  const conditions = [];
  const values = [];

  function addCondition(sql, value) {
    values.push(value);
    conditions.push(sql.replace('?', '$' + values.length));
  }

  if (unitId) addCondition('b.unit_id = ?', unitId);
  if (periodStart) addCondition('b.billing_period = ?::DATE', periodStart);
  if (status) addCondition('b.status = ?', status);
  if (overdue !== undefined) addCondition('b.is_overdue = ?', overdue);

  values.push(limit + 1, offset);

  const result = await db.query(
    `SELECT ${INVOICE_COLUMNS}
     FROM community.invoice_balances b
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY b.billing_period DESC, b.unit_id, b.id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    invoices: result.rows.slice(0, limit),
    hasMore: result.rows.length > limit
  };
}

export async function selectOverdueInvoices(db, { unitId, limit, offset }) {
  const values = [];
  let unitCondition = '';

  if (unitId) {
    values.push(unitId);
    unitCondition = 'AND b.unit_id = $1';
  }

  const summary = await db.query(
    `SELECT
       COUNT(*)::INTEGER AS "overdueCount",
       COALESCE(SUM(b.remaining_amount_minor), 0)::BIGINT
         AS "totalRemainingMinor"
     FROM community.invoice_balances b
     WHERE b.is_overdue ${unitCondition}`,
    values
  );

  values.push(limit + 1, offset);

  const result = await db.query(
    `SELECT ${INVOICE_COLUMNS}
     FROM community.invoice_balances b
     WHERE b.is_overdue ${unitCondition}
     ORDER BY b.due_date, b.unit_id, b.id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    overdueCount: summary.rows[0].overdueCount,
    totalRemainingMinor: Number(summary.rows[0].totalRemainingMinor),
    invoices: result.rows.slice(0, limit),
    hasMore: result.rows.length > limit
  };
}

export async function selectInvoiceById(db, invoiceId) {
  const result = await db.query(
    `SELECT ${INVOICE_COLUMNS}
     FROM community.invoice_balances b
     WHERE b.id = $1`,
    [invoiceId]
  );

  return result.rows[0] ?? null;
}
