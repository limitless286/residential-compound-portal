import { getMonitorDatabase } from '../config/monitorDatabase.js';
import { recordOverdueNotification } from '../repositories/overdueMonitorRepository.js';
import { createConsumerHandler } from './overdueWorkerHandlers.js';

export const handler = createConsumerHandler({
  queueArn: process.env.OVERDUE_QUEUE_ARN,
  recordNotification: async job => recordOverdueNotification(await getMonitorDatabase(), job)
});
