import {
  insertPayment,
  lockInvoiceForPayment,
  paymentReferenceExists,
  sumPaymentsForInvoice
} from '../repositories/paymentRepository.js';
import { selectInvoiceById } from '../repositories/invoiceRepository.js';
import { executeIdempotent, idempotencyStore } from './idempotencyService.js';
import { httpError } from '../utils/httpError.js';
import { logAction } from '../utils/logger.js';
import {
  invalidInput,
  requireBody,
  requireEnum,
  requireInteger,
  requireText,
  requireTimestamp,
  requireUuid
} from '../utils/validation.js';

export const PAYMENT_ENDPOINT = 'POST /api/v1/admin/payments';
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER'];

// Offline payments only. A small allowance covers clock differences.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_AMOUNT_MINOR = 2_147_483_647;

const defaultDeps = {
  lockInvoiceForPayment,
  sumPaymentsForInvoice,
  paymentReferenceExists,
  insertPayment,
  selectInvoiceById,
  idempotency: idempotencyStore
};

export function validatePayment(body, now = new Date()) {
  requireBody(body, [
    'invoiceId',
    'amountMinor',
    'paymentReference',
    'paymentMethod',
    'paidAt'
  ]);

  const paidAt = requireTimestamp(body.paidAt, 'paidAt');

  if (Date.parse(paidAt) > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw invalidInput('paidAt cannot be in the future.');
  }

  return {
    invoiceId: requireUuid(body.invoiceId, 'invoiceId'),
    amountMinor: requireInteger(body.amountMinor, 'amountMinor', {
      min: 1,
      max: MAX_AMOUNT_MINOR
    }),
    paymentReference: requireText(body.paymentReference, 'paymentReference', {
      min: 1,
      max: 100
    }),
    paymentMethod: requireEnum(
      body.paymentMethod,
      'paymentMethod',
      PAYMENT_METHODS
    ),
    paidAt
  };
}

function duplicateReference() {
  return httpError(
    409,
    'DUPLICATE_PAYMENT_REFERENCE',
    'A payment with this reference has already been recorded.'
  );
}

// Maps unique-constraint races that slip past the pre-checks.
function mapUniqueViolation(error) {
  if (error?.code !== '23505') {
    return error;
  }

  if (error.constraint === 'payments_payment_reference_key') {
    return duplicateReference();
  }

  if (error.constraint === 'payments_idempotency_key_key') {
    return httpError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'This Idempotency-Key was already used for another payment.'
    );
  }

  return error;
}

export async function recordPayment(
  { user, idempotencyKey, body, requestId, now = new Date() },
  deps = defaultDeps
) {
  const payment = validatePayment(body, now);

  const scope = {
    callerService: 'portal',
    userId: user.id,
    endpoint: PAYMENT_ENDPOINT,
    idempotencyKey
  };

  try {
    const result = await executeIdempotent({
      scope,
      payload: payment,

      // Lock, balance read, overpayment check and insert all run on the
      // same client inside one transaction.
      perform: async (client) => {
        const invoice = await deps.lockInvoiceForPayment(
          client,
          payment.invoiceId
        );

        if (!invoice) {
          throw httpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
        }

        const paidAmountMinor = await deps.sumPaymentsForInvoice(
          client,
          invoice.id
        );
        const remainingAmountMinor = invoice.amountMinor - paidAmountMinor;

        if (remainingAmountMinor <= 0) {
          throw httpError(
            409,
            'INVOICE_ALREADY_PAID',
            'This invoice has already been paid in full.'
          );
        }

        if (payment.amountMinor > remainingAmountMinor) {
          throw httpError(
            409,
            'OVERPAYMENT',
            'The payment exceeds the remaining balance of ' +
              remainingAmountMinor + ' minor units.'
          );
        }

        if (await deps.paymentReferenceExists(client, payment.paymentReference)) {
          throw duplicateReference();
        }

        let saved;

        try {
          saved = await deps.insertPayment(client, {
            ...payment,
            recordedBy: user.id,
            idempotencyKey
          });
        } catch (error) {
          throw mapUniqueViolation(error);
        }

        // Read through the view on the same transaction so the response
        // reflects the payment just inserted.
        const balance = await deps.selectInvoiceById(client, invoice.id);

        return {
          status: 201,
          data: {
            payment: saved,
            invoice: {
              id: balance.id,
              unitId: balance.unitId,
              billingPeriod: balance.billingPeriod,
              amountMinor: balance.amountMinor,
              paidAmountMinor: balance.paidAmountMinor,
              remainingAmountMinor: balance.remainingAmountMinor,
              status: balance.status,
              isOverdue: balance.isOverdue
            }
          }
        };
      }
    }, deps.idempotency);

    logAction({
      requestId,
      action: 'PAYMENT_RECORD',
      outcome: result.replayed ? 'REPLAYED' : 'SUCCEEDED',
      userId: user.id,
      invoiceId: payment.invoiceId,
      paymentId: result.data.payment.id,
      amountMinor: payment.amountMinor
    });

    return result;
  } catch (error) {
    logAction({
      requestId,
      action: 'PAYMENT_RECORD',
      outcome: 'FAILED',
      level: 'warn',
      userId: user.id,
      invoiceId: payment.invoiceId,
      code: error.code || 'UNKNOWN'
    });

    throw error;
  }
}
