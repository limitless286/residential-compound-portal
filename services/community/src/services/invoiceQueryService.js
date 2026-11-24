import { getDatabase } from '../config/database.js';
import {
  selectInvoiceById,
  selectInvoices
} from '../repositories/invoiceRepository.js';
import { httpError } from '../utils/httpError.js';
import {
  invalidInput,
  parseBillingPeriod,
  requireEnum,
  requireQuery,
  requireUuid
} from '../utils/validation.js';

export const INVOICE_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;

const defaultDeps = {
  selectInvoices: (filters) => selectInvoices(getDatabase(), filters),
  selectInvoiceById: (id) => selectInvoiceById(getDatabase(), id)
};

function parseBoundedInteger(value, field, defaultValue, min, max) {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d{1,6}$/.test(value) || Number(value) < min || Number(value) > max) {
    throw invalidInput(
      field + ' must be an integer between ' + min + ' and ' + max + '.'
    );
  }

  return Number(value);
}

function residentUnitId(user) {
  if (!user.unitId) {
    throw httpError(403, 'FORBIDDEN', 'No unit is linked to this account.');
  }

  return user.unitId.toLowerCase();
}

export async function listInvoices({ user, query }, deps = defaultDeps) {
  const isAdmin = user.role === 'ADMIN';
  const allowed = ['billingPeriod', 'status', 'overdue', 'limit', 'offset'];

  // Residents cannot choose a unit; their unit comes from the session.
  requireQuery(query, isAdmin ? [...allowed, 'unitId'] : allowed);

  const filters = {
    unitId: isAdmin
      ? (query.unitId === undefined ? undefined : requireUuid(query.unitId, 'unitId'))
      : residentUnitId(user),
    periodStart: query.billingPeriod === undefined
      ? undefined
      : parseBillingPeriod(query.billingPeriod).periodStart,
    status: query.status === undefined
      ? undefined
      : requireEnum(query.status, 'status', INVOICE_STATUSES),
    overdue: query.overdue === undefined
      ? undefined
      : requireEnum(query.overdue, 'overdue', ['true', 'false']) === 'true',
    limit: parseBoundedInteger(query.limit, 'limit', DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: parseBoundedInteger(query.offset, 'offset', 0, 0, MAX_OFFSET)
  };

  const { invoices, hasMore } = await deps.selectInvoices(filters);

  return {
    invoices,
    limit: filters.limit,
    offset: filters.offset,
    nextOffset: hasMore ? filters.offset + filters.limit : null
  };
}

export async function getInvoice({ user, invoiceId }, deps = defaultDeps) {
  const id = requireUuid(invoiceId, 'id');
  const ownUnitId = user.role === 'ADMIN' ? null : residentUnitId(user);
  const invoice = await deps.selectInvoiceById(id);

  if (!invoice) {
    throw httpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
  }

  if (ownUnitId !== null && invoice.unitId.toLowerCase() !== ownUnitId) {
    throw httpError(
      403,
      'FORBIDDEN',
      'You can only view invoices for your own unit.'
    );
  }

  return invoice;
}
