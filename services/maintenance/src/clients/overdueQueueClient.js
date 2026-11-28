import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { validateOverdueJob } from '../services/overdueMonitorService.js';

export async function enqueueOverdueJobs(jobs, {
  client,
  queueUrl = process.env.OVERDUE_QUEUE_URL,
  env = process.env,
  now = () => new Date()
} = {}) {
  if (!Array.isArray(jobs) || jobs.length > 100) {
    throw new Error('Invalid overdue job batch.');
  }
  // Validate every entry before starting any network requests.
  const validated = jobs.map(job => validateOverdueJob(job, now()));
  if (!validated.length) return { queued: 0 };
  if (!queueUrl) throw new Error('Overdue queue is not configured.');
  const sqs = client || new SQSClient({
    region: env.AWS_REGION,
    endpoint: env.SQS_ENDPOINT_URL || undefined,
    maxAttempts: 2
  });
  const batches = [];
  for (let offset = 0; offset < validated.length; offset += 10) {
    batches.push(validated.slice(offset, offset + 10).map((job, index) => ({
      Id: 'job' + (offset + index), MessageBody: JSON.stringify(job)
    })));
  }
  // Await all sends, including failures, before the Lambda can return.
  const outcomes = await Promise.allSettled(batches.map(async Entries => {
    const response = await sqs.send(new SendMessageBatchCommand({
      QueueUrl: queueUrl, Entries
    }), { abortSignal: AbortSignal.timeout(10000) });
    const ids = new Set((response.Successful || []).map(item => item.Id));
    if (response.Failed?.length || ids.size !== Entries.length ||
        Entries.some(entry => !ids.has(entry.Id))) {
      throw new Error('Partial queue batch failure.');
    }
  }));
  if (outcomes.some(result => result.status === 'rejected')) {
    throw new Error('Overdue alert messages could not be enqueued.');
  }
  return { queued: validated.length };
}
