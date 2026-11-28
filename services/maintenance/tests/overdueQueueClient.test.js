import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueOverdueJobs } from '../src/clients/overdueQueueClient.js';
const now = () => new Date('2026-11-28T12:00:00.000Z');
const job = () => ({ type: 'MAINTENANCE_OVERDUE_V1', requestId: '11111111-1111-4111-8111-111111111111',
  dueAt: '2026-11-27T10:00:00.000Z', windowStart: '2026-11-28T00:00:00.000Z', repeatAfterHours: 24 });
const options = { now, queueUrl: 'http://queue.test/alerts' };
test('splits 23 jobs into 10, 10 and 3 and checks all acknowledgements', async () => {
  const batches = [];
  const result = await enqueueOverdueJobs(Array.from({ length: 23 }, job), {
    ...options, client: { send: async command => {
      assert.equal(command.input.QueueUrl, options.queueUrl);
      batches.push(command.input.Entries);
      assert.deepEqual(JSON.parse(command.input.Entries[0].MessageBody), job());
      return { Successful: command.input.Entries.map(entry => ({ Id: entry.Id })) };
    } }
  });
  assert.deepEqual(batches.map(batch => batch.length), [10, 10, 3]);
  assert.equal(result.queued, 23);
});
test('rejects partial acknowledgement and unknown success IDs', async () => {
  for (const result of [{ Failed: [{ Id: 'job0' }] }, { Successful: [{ Id: 'wrong' }] }]) {
    await assert.rejects(enqueueOverdueJobs([job()], {
      ...options, client: { send: async () => result }
    }), /could not be enqueued/);
  }
});
test('validates the whole batch before sending, including token injection', async () => {
  let calls = 0;
  await assert.rejects(enqueueOverdueJobs([job(), { ...job(), token: 'private' }], {
    ...options, client: { send: async () => { calls++; } }
  }));
  assert.equal(calls, 0);
});
test('empty input makes no SDK calls', async () => {
  assert.deepEqual(await enqueueOverdueJobs([], {
    client: { send: () => assert.fail('unexpected send') }
  }), { queued: 0 });
});
test('failed concurrent sends are all awaited before returning', async () => {
  let finished = false;
  await assert.rejects(enqueueOverdueJobs(Array.from({ length: 11 }, job), {
    ...options, client: { send: async command => {
      if (command.input.Entries[0].Id === 'job0') throw new Error('failure');
      await new Promise(resolve => setTimeout(resolve, 20));
      finished = true;
      return { Successful: command.input.Entries.map(entry => ({ Id: entry.Id })) };
    } }
  }));
  assert.equal(finished, true);
});
