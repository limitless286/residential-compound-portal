import { validateMonitorConfig } from '../config/overdueMonitorConfig.js';

const JOB_TYPE = 'MAINTENANCE_OVERDUE_V1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireIso(value) {
  if (typeof value !== 'string') {
    throw new Error('Invalid overdue job timestamp.');
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString() !== value) {
    throw new Error('Invalid overdue job timestamp.');
  }

  return timestamp;
}

export function validateOverdueJob(value, now = new Date()) {
  const allowed = ['type', 'requestId', 'dueAt', 'windowStart'];

  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) ||
      value.type !== JOB_TYPE ||
      typeof value.requestId !== 'string' ||
      !UUID_PATTERN.test(value.requestId)) {
    throw new Error('Invalid overdue notification job.');
  }

  const dueAt = requireIso(value.dueAt);
  const windowStart = requireIso(value.windowStart);
  const currentTime = now.getTime();

  if (!Number.isFinite(currentTime) ||
      dueAt >= currentTime || windowStart > currentTime) {
    throw new Error('Overdue notification job contains future timestamps.');
  }

  return {
    type: JOB_TYPE,
    requestId: value.requestId.toLowerCase(),
    dueAt: value.dueAt,
    windowStart: value.windowStart
  };
}

export async function scanOverdueRequests({
  readConfig,
  findOverdue,
  enqueueJobs,
  now = () => new Date()
}) {
  const config = validateMonitorConfig(await readConfig());

  if (!config.enabled) {
    return { enabled: false, found: 0, queued: 0 };
  }

  const currentTime = now();
  const milliseconds = currentTime.getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new Error('Invalid monitor clock.');
  }

  const windowLength = config.repeatAfterHours * 60 * 60 * 1000;
  const windowStart = new Date(
    Math.floor(milliseconds / windowLength) * windowLength
  ).toISOString();

  const requests = await findOverdue({
    asOf: currentTime.toISOString(),
    windowStart,
    limit: config.batchSize
  });

  if (!Array.isArray(requests) || requests.length > config.batchSize) {
    throw new Error('Unexpected overdue query result.');
  }

  const jobs = requests.map(request => validateOverdueJob({
    type: JOB_TYPE,
    requestId: request.requestId,
    dueAt: request.dueAt,
    windowStart
  }, currentTime));

  if (jobs.length > 0) {
    await enqueueJobs(jobs);
  }

  return {
    enabled: true,
    found: jobs.length,
    queued: jobs.length
  };
}

export async function processOverdueJob(
  payload,
  { recordNotification, now = () => new Date() }
) {
  const job = validateOverdueJob(payload, now());
  const result = await recordNotification(job);

  return {
    requestId: job.requestId,
    created: result.created,
    notificationId: result.notificationId
  };
}
