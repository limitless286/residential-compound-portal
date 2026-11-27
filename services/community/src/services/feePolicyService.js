import { getDatabase } from '../config/database.js';
import {
  selectFeePolicy,
  upsertFeePolicy
} from '../repositories/feePolicyRepository.js';
import { httpError } from '../utils/httpError.js';
import { logAction } from '../utils/logger.js';
import {
  requireBody,
  requireEnum,
  requireInteger
} from '../utils/validation.js';

export const FEE_POLICY_RULES = {
  minMonthlyAmountMinor: 1,
  maxMonthlyAmountMinor: 100_000_000,
  minDueDay: 1,
  maxDueDay: 28,
  currencies: ['EGP']
};

const defaultDeps = {
  selectFeePolicy: () => selectFeePolicy(getDatabase()),
  upsertFeePolicy: (policy) => upsertFeePolicy(getDatabase(), policy)
};

export function validateFeePolicy(body) {
  requireBody(body, ['monthlyAmountMinor', 'currency', 'dueDay']);

  return {
    monthlyAmountMinor: requireInteger(
      body.monthlyAmountMinor,
      'monthlyAmountMinor',
      {
        min: FEE_POLICY_RULES.minMonthlyAmountMinor,
        max: FEE_POLICY_RULES.maxMonthlyAmountMinor
      }
    ),
    currency: body.currency === undefined
      ? 'EGP'
      : requireEnum(body.currency, 'currency', FEE_POLICY_RULES.currencies),
    dueDay: requireInteger(body.dueDay, 'dueDay', {
      min: FEE_POLICY_RULES.minDueDay,
      max: FEE_POLICY_RULES.maxDueDay
    })
  };
}

export async function getFeePolicy(deps = defaultDeps) {
  const policy = await deps.selectFeePolicy();

  if (!policy) {
    throw httpError(
      404,
      'FEE_POLICY_NOT_FOUND',
      'No fee policy has been configured.'
    );
  }

  return policy;
}

export async function updateFeePolicy(
  { body, user, requestId },
  deps = defaultDeps
) {
  const policy = validateFeePolicy(body);
  const saved = await deps.upsertFeePolicy(policy);

  logAction({
    requestId,
    action: 'FEE_POLICY_UPDATE',
    outcome: 'SUCCEEDED',
    userId: user.id,
    monthlyAmountMinor: saved.monthlyAmountMinor,
    dueDay: saved.dueDay
  });

  return saved;
}
