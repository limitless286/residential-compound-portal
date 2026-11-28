import test from 'node:test';
import assert from 'node:assert/strict';
import { createScannerHandler, createConsumerHandler } from '../src/workers/overdueWorkerHandlers.js';
import { getOverdueNotifications } from '../src/services/overdueNotificationsService.js';
import { withMonitorTransaction } from '../src/utils/monitorTransaction.js';
import { EventEmitter } from 'node:events';
const queueArn = 'arn:aws:sqs:us-east-1:000000000000:compound-maintenance-overdue';
const now = () => new Date('2026-11-28T12:00:00.000Z');
function record(id = 'm1') {
  return { messageId: id, eventSource: 'aws:sqs', eventSourceARN: queueArn, body: JSON.stringify({
    type: 'MAINTENANCE_OVERDUE_V1', requestId: '11111111-1111-4111-8111-111111111111',
    dueAt: '2026-11-27T00:00:00.000Z', windowStart: '2026-11-28T00:00:00.000Z', repeatAfterHours: 24
  }) };
}
test('scanner rejects unexpected events before reading configuration', async () => {
  const handler = createScannerHandler({ readConfig: () => assert.fail('must not read') });
  await assert.rejects(handler({ source: 'unknown' }));
});
test('scheduled scanner honors disabled configuration', async () => {
  const handler = createScannerHandler({ readConfig: async () => ({ enabled: false, batchSize: 50, repeatAfterHours: 24 }) });
  assert.equal((await handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' })).enabled, false);
});
test('consumer rejects another queue before processing any record', async () => {
  const handler = createConsumerHandler({ queueArn, recordNotification: () => assert.fail('must not write') });
  await assert.rejects(handler({ Records: [record(), { ...record('m2'), eventSourceARN: 'another-queue' }] }));
});
test('only failed records are retried; invalid JSON does not discard successful records', async () => {
  let writes = 0;
  const handler = createConsumerHandler({ queueArn, now, recordNotification: async () => {
    writes++; return { created: true, notificationId: 'saved' };
  } });
  const result = await handler({ Records: [record(), { ...record('m2'), body: '{invalid' }] });
  assert.equal(writes, 1);
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: 'm2' }] });
});
test('database errors mark the message for retry without exposing details', async () => {
  const handler = createConsumerHandler({ queueArn, now, recordNotification: async () => { throw new Error('private'); } });
  assert.deepEqual(await handler({ Records: [record()] }), { batchItemFailures: [{ itemIdentifier: 'm1' }] });
});
test('obsolete notification is a successful skip, not an endless retry', async () => {
  const handler = createConsumerHandler({ queueArn, now, recordNotification: async () => ({ created: false, notificationId: null }) });
  assert.deepEqual(await handler({ Records: [record()] }), { batchItemFailures: [] });
});
test('notifications require ADMIN before accessing the database', async () => {
  for (const [user, status] of [[null, 401], [{ role: 'RESIDENT' }, 403]]) {
    await assert.rejects(getOverdueNotifications(user, {}, { listNotifications: () => assert.fail('must not read') }), e => e.status === status);
  }
});
test('notification list rejects invalid queries and detects more results', async () => {
  const user = { role: 'ADMIN' };
  for (const query of [{ userId: 'other' }, { limit: ['1', '2'] }, { limit: '0' }, { limit: '101' }]) {
    await assert.rejects(getOverdueNotifications(user, query, { listNotifications: () => assert.fail('must not read') }), e => e.status === 400);
  }
  const result = await getOverdueNotifications(user, { limit: '1' }, {
    listNotifications: async options => { assert.equal(options.limit, 2); return [{ id: 'a' }, { id: 'b' }]; }
  });
  assert.deepEqual(result.notifications, [{ id: 'a' }]);
  assert.equal(result.pagination.hasMore, true);
});
test('notification dependency errors return a safe 503', async () => {
  await assert.rejects(getOverdueNotifications({ role: 'ADMIN' }, {}, {
    listNotifications: async () => { throw new Error('secret connection string'); }
  }), e => e.status === 503 && !e.message.includes('connection string'));
});
function fakePool(failure) {
  const client = new EventEmitter();
  client.calls = [];
  client.query = async sql => { client.calls.push(sql); if (sql === 'ROLLBACK' && failure) throw failure; };
  client.release = destroy => { client.destroyed = destroy; };
  return { client, connect: async () => client };
}
test('transaction rollback failure destroys the connection and preserves the original error', async () => {
  const pool = fakePool(new Error('rollback failed'));
  const original = new Error('business failure');
  await assert.rejects(withMonitorTransaction(pool, async () => { throw original; }), e => e === original);
  assert.equal(pool.client.destroyed, true);
  assert.equal(pool.client.listenerCount('error'), 0);
});
test('connection error during work prevents commit and destroys the connection', async () => {
  const pool = fakePool();
  await assert.rejects(withMonitorTransaction(pool, async client => { client.emit('error', new Error('disconnect')); }));
  assert.equal(pool.client.calls.includes('COMMIT'), false);
  assert.equal(pool.client.destroyed, true);
});
