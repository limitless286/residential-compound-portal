import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanOverdueRequests,
  processOverdueJob,
  validateOverdueJob
} from '../src/services/overdueMonitorService.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const clock = () => new Date('2026-11-27T12:00:00.000Z');

const config = {
  enabled: true,
  batchSize: 50,
  repeatAfterHours: 24
};

function job() {
  return {
    type: 'MAINTENANCE_OVERDUE_V1',
    requestId,
    dueAt: '2026-11-26T12:00:00.000Z',
    windowStart: '2026-11-27T00:00:00.000Z'
  };
}

test('disabled monitoring does not query requests or enqueue work', async () => {
  const result = await scanOverdueRequests({
    readConfig: async () => ({ ...config, enabled: false }),
    findOverdue: async () => assert.fail('Database must not be queried.'),
    enqueueJobs: async () => assert.fail('Queue must not be called.'),
    now: clock
  });

  assert.deepEqual(result, {
    enabled: false, found: 0, queued: 0
  });
});

test('configuration failure stops the scan', async () => {
  await assert.rejects(scanOverdueRequests({
    readConfig: async () => { throw new Error('SSM unavailable'); },
    findOverdue: async () => assert.fail('Database must not be queried.'),
    enqueueJobs: async () => assert.fail('Queue must not be called.'),
    now: clock
  }), /SSM unavailable/);
});

test('scan uses configured batch size and sends minimal job data', async () => {
  let queued;

  const result = await scanOverdueRequests({
    readConfig: async () => config,
    findOverdue: async options => {
      assert.deepEqual(options, {
        asOf: '2026-11-27T12:00:00.000Z',
        windowStart: '2026-11-27T00:00:00.000Z',
        limit: 50
      });

      return [{
        requestId,
        dueAt: '2026-11-26T12:00:00.000Z',
        privateDetails: 'must-not-be-enqueued'
      }];
    },
    enqueueJobs: async jobs => { queued = jobs; },
    now: clock
  });

  assert.deepEqual(queued, [job()]);
  assert.deepEqual(result, {
    enabled: true, found: 1, queued: 1
  });
});

test('empty scan does not send an empty queue batch', async () => {
  const result = await scanOverdueRequests({
    readConfig: async () => config,
    findOverdue: async () => [],
    enqueueJobs: async () => assert.fail('Queue must not be called.'),
    now: clock
  });

  assert.equal(result.queued, 0);
});

test('repeated scans in the same period use the same notification window', async () => {
  const jobs = [];

  for (const time of [
    '2026-11-27T12:00:00.000Z',
    '2026-11-27T12:10:00.000Z'
  ]) {
    await scanOverdueRequests({
      readConfig: async () => config,
      findOverdue: async () => [{
        requestId,
        dueAt: '2026-11-26T12:00:00.000Z'
      }],
      enqueueJobs: async batch => { jobs.push(batch[0]); },
      now: () => new Date(time)
    });
  }

  assert.deepEqual(jobs[0], jobs[1]);
});

test('enqueue failure is propagated for retry', async () => {
  await assert.rejects(scanOverdueRequests({
    readConfig: async () => config,
    findOverdue: async () => [{
      requestId,
      dueAt: '2026-11-26T12:00:00.000Z'
    }],
    enqueueJobs: async () => { throw new Error('Queue unavailable'); },
    now: clock
  }), /Queue unavailable/);
});

test('invalid job identifiers, fields and timestamps are rejected', () => {
  for (const changes of [
    { requestId: 'invalid' },
    { type: 'UNKNOWN' },
    { userToken: 'must-not-be-accepted' },
    { dueAt: 'not-a-date' },
    { dueAt: '2026-11-28T00:00:00.000Z' },
    { windowStart: '2026-11-28T00:00:00.000Z' }
  ]) {
    assert.throws(() => validateOverdueJob({
      ...job(),
      ...changes
    }, clock()));
  }
});

test('valid job is passed to the notification repository', async () => {
  const result = await processOverdueJob(job(), {
    now: clock,
    recordNotification: async received => {
      assert.deepEqual(received, job());
      return { created: true, notificationId: 'saved-notification' };
    }
  });

  assert.deepEqual(result, {
    requestId,
    created: true,
    notificationId: 'saved-notification'
  });
});

test('obsolete or already recorded jobs can finish without another insert', async () => {
  const result = await processOverdueJob(job(), {
    now: clock,
    recordNotification: async () => ({
      created: false,
      notificationId: null
    })
  });

  assert.equal(result.created, false);
  assert.equal(result.notificationId, null);
});

test('database failure is propagated instead of reporting successful processing', async () => {
  await assert.rejects(processOverdueJob(job(), {
    now: clock,
    recordNotification: async () => {
      throw new Error('Database unavailable');
    }
  }), /Database unavailable/);
});
