import { getDatabase } from '../config/database.js';
import { fetchAllActiveUnits } from '../clients/identityClient.js';
import { selectFeePolicy } from '../repositories/feePolicyRepository.js';
import { insertInvoicesForUnits } from '../repositories/invoiceRepository.js';
import { executeIdempotent, idempotencyStore } from './idempotencyService.js';
import { httpError } from '../utils/httpError.js';
import { logAction } from '../utils/logger.js';
import {
  invalidInput,
  parseBillingPeriod,
  requireBody
} from '../utils/validation.js';

export const INVOICE_GENERATION_ENDPOINT =
  'POST /api/v1/admin/invoice-generations';

// Invoices may be generated for past periods and up to one month ahead.
const MAX_MONTHS_AHEAD = 1;

const defaultDeps = {
  selectFeePolicy: () => selectFeePolicy(getDatabase()),
  fetchAllActiveUnits,
  insertInvoicesForUnits,
  idempotency: idempotencyStore
};

export function cairoBillingPeriod(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  return year + '-' + month;
}

export function addMonths(billingPeriod, months) {
  const [year, month] = billingPeriod.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

export async function generateInvoices(
  { user, authorization, idempotencyKey, body, requestId, now = new Date() },
  deps = defaultDeps
) {
  requireBody(body, ['billingPeriod']);
  const { billingPeriod, periodStart } = parseBillingPeriod(body.billingPeriod);

  const latestAllowed = addMonths(cairoBillingPeriod(now), MAX_MONTHS_AHEAD);

  if (billingPeriod > latestAllowed) {
    throw invalidInput(
      'billingPeriod cannot be later than ' + latestAllowed + '.'
    );
  }

  const scope = {
    callerService: 'portal',
    userId: user.id,
    endpoint: INVOICE_GENERATION_ENDPOINT,
    idempotencyKey
  };

  try {
    const result = await executeIdempotent({
      scope,
      payload: { billingPeriod },

      // Runs outside the transaction: no network calls hold a database lock.
      prepare: async () => {
        const policy = await deps.selectFeePolicy();

        if (!policy) {
          throw httpError(
            409,
            'FEE_POLICY_REQUIRED',
            'Configure the fee policy before generating invoices.'
          );
        }

        // All pages are collected before any invoice is created.
        const units = await deps.fetchAllActiveUnits({
          authorization,
          requestId
        });

        return { policy, units };
      },

      perform: async (client, { policy, units }) => {
        const dueDate =
          billingPeriod + '-' + String(policy.dueDay).padStart(2, '0');

        const createdCount = units.length === 0
          ? 0
          : await deps.insertInvoicesForUnits(client, {
            unitIds: units.map((unit) => unit.unitId),
            periodStart,
            amountMinor: policy.monthlyAmountMinor,
            currency: policy.currency,
            dueDate,
            generatedBy: user.id
          });

        return {
          status: 201,
          data: {
            billingPeriod,
            monthlyAmountMinor: policy.monthlyAmountMinor,
            currency: policy.currency,
            dueDate,
            activeUnitCount: units.length,
            createdCount,
            skippedCount: units.length - createdCount
          }
        };
      }
    }, deps.idempotency);

    logAction({
      requestId,
      action: 'INVOICE_GENERATION',
      outcome: result.replayed ? 'REPLAYED' : 'SUCCEEDED',
      userId: user.id,
      billingPeriod,
      createdCount: result.data.createdCount,
      skippedCount: result.data.skippedCount
    });

    return result;
  } catch (error) {
    logAction({
      requestId,
      action: 'INVOICE_GENERATION',
      outcome: 'FAILED',
      level: 'warn',
      userId: user.id,
      billingPeriod,
      code: error.code || 'UNKNOWN'
    });

    throw error;
  }
}
