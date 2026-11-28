import { randomUUID } from 'node:crypto';
import { scanOverdueRequests, processOverdueJob } from '../services/overdueMonitorService.js';

function log(action, outcome, requestId, details = {}, error = false) {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(), service: 'maintenance',
    action, outcome, requestId, ...details
  });
  if (error) console.error(record); else console.log(record);
}

export function createScannerHandler(deps) {
  return async (event, context = {}) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const requestId = context.awsRequestId || randomUUID();
    if (!event || !(
      event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event' ||
      event.source === 'compound.maintenance.monitor' && event.action === 'scan'
    )) throw new Error('Unsupported monitor event.');
    try {
      const result = await scanOverdueRequests(deps);
      log('OVERDUE_SCAN', result.enabled ? 'SUCCEEDED' : 'DISABLED', requestId, result);
      return result;
    } catch {
      log('OVERDUE_SCAN', 'FAILED', requestId, {}, true);
      throw new Error('Overdue scan failed.');
    }
  };
}

export function createConsumerHandler({ recordNotification, queueArn, now }) {
  return async (event, context = {}) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const requestId = context.awsRequestId || randomUUID();
    if (!queueArn || !Array.isArray(event?.Records) ||
        event.Records.length > 10 || event.Records.some(record =>
          typeof record?.messageId !== 'string' || !record.messageId ||
          record.eventSource !== 'aws:sqs' || record.eventSourceARN !== queueArn
        )) throw new Error('Unexpected overdue queue event.');
    const batchItemFailures = [];
    for (const record of event.Records) {
      try {
        if (typeof record.body !== 'string' || Buffer.byteLength(record.body) > 4096) {
          throw new Error('Invalid queue body.');
        }
        const result = await processOverdueJob(JSON.parse(record.body), {
          recordNotification, ...(now ? { now } : {})
        });
        log('OVERDUE_NOTIFICATION', result.created ? 'CREATED' : 'SKIPPED', requestId, {
          maintenanceRequestId: result.requestId,
          notificationId: result.notificationId
        });
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId });
        log('OVERDUE_NOTIFICATION', 'FAILED', requestId, {}, true);
      }
    }
    return { batchItemFailures };
  };
}
