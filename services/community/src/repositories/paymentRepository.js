const PAYMENT_COLUMNS = `
  id,
  invoice_id AS "invoiceId",
  amount_minor AS "amountMinor",
  payment_reference AS "paymentReference",
  payment_method AS "paymentMethod",
  paid_at AS "paidAt",
  recorded_by AS "recordedBy",
  created_at AS "createdAt"
`;

// Takes a row lock on the invoice for the rest of the transaction.
// Concurrent payments for the same invoice wait here, so the balance read
// and the overpayment check below always see every committed payment.
// Requires the column-level UPDATE (lock_version) grant from migration 006.
export async function lockInvoiceForPayment(client, invoiceId) {
  const result = await client.query(
    `SELECT
       id,
       unit_id AS "unitId",
       amount_minor AS "amountMinor",
       currency
     FROM community.invoices
     WHERE id = $1
     FOR UPDATE`,
    [invoiceId]
  );

  return result.rows[0] ?? null;
}

// Must be called on the same client and transaction as the lock.
export async function sumPaymentsForInvoice(client, invoiceId) {
  const result = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::BIGINT AS "paidAmountMinor"
     FROM community.payments
     WHERE invoice_id = $1`,
    [invoiceId]
  );

  return Number(result.rows[0].paidAmountMinor);
}

export async function paymentReferenceExists(client, paymentReference) {
  const result = await client.query(
    `SELECT 1
     FROM community.payments
     WHERE payment_reference = $1`,
    [paymentReference]
  );

  return result.rowCount > 0;
}

export async function insertPayment(client, payment) {
  const result = await client.query(
    `INSERT INTO community.payments
       (invoice_id, amount_minor, payment_reference, payment_method,
        paid_at, recorded_by, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${PAYMENT_COLUMNS}`,
    [
      payment.invoiceId,
      payment.amountMinor,
      payment.paymentReference,
      payment.paymentMethod,
      payment.paidAt,
      payment.recordedBy,
      payment.idempotencyKey
    ]
  );

  return result.rows[0];
}

export async function selectPaymentsForInvoice(db, invoiceId) {
  const result = await db.query(
    `SELECT ${PAYMENT_COLUMNS}
     FROM community.payments
     WHERE invoice_id = $1
     ORDER BY paid_at, created_at, id`,
    [invoiceId]
  );

  return result.rows;
}
