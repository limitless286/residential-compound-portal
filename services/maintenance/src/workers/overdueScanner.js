import { readMonitorConfig } from '../config/overdueMonitorConfig.js';
import { getMonitorDatabase } from '../config/monitorDatabase.js';
import { findUnnotifiedOverdue } from '../repositories/overdueMonitorRepository.js';
import { enqueueOverdueJobs } from '../clients/overdueQueueClient.js';
import { createScannerHandler } from './overdueWorkerHandlers.js';

export const handler = createScannerHandler({
  readConfig: readMonitorConfig,
  findOverdue: async options => findUnnotifiedOverdue(await getMonitorDatabase(), options),
  enqueueJobs: enqueueOverdueJobs
});
