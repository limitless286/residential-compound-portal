import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { httpError } from '../utils/httpError.js';

export const OVERDUE_MONITOR_PARAMETER =
  '/compound/maintenance/overdue-monitor';

export function validateMonitorConfig(value) {
  const allowed = ['enabled', 'batchSize', 'repeatAfterHours'];

  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) ||
      typeof value.enabled !== 'boolean' ||
      !Number.isSafeInteger(value.batchSize) ||
      value.batchSize < 1 || value.batchSize > 100 ||
      !Number.isSafeInteger(value.repeatAfterHours) ||
      value.repeatAfterHours < 1 || value.repeatAfterHours > 168) {
    throw new Error('Invalid overdue monitor configuration.');
  }

  return {
    enabled: value.enabled,
    batchSize: value.batchSize,
    repeatAfterHours: value.repeatAfterHours
  };
}

export async function readMonitorConfig({
  client,
  env = process.env
} = {}) {
  const ssm = client || new SSMClient({
    region: env.AWS_REGION,
    endpoint: env.SSM_ENDPOINT_URL || undefined,
    maxAttempts: 2
  });

  try {
    const result = await ssm.send(
      new GetParameterCommand({
        Name: OVERDUE_MONITOR_PARAMETER,
        WithDecryption: false
      }),
      { abortSignal: AbortSignal.timeout(10000) }
    );

    if (result.Parameter?.Type !== 'String') {
      throw new Error('Unexpected parameter type.');
    }

    return validateMonitorConfig(JSON.parse(result.Parameter.Value));
  } catch {
    throw httpError(
      503,
      'MONITOR_CONFIG_UNAVAILABLE',
      'Overdue monitoring configuration is unavailable.'
    );
  }
}
