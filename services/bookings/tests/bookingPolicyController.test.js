import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';

const { database } = await import('../src/config/database.js');
const {
  getBookingPolicyRecord,
  replaceBookingPolicyRecord
} = await import('../src/controllers/bookingPolicyController.js');

const adminActor = { id: '11111111-1111-4111-8111-111111111111', role: 'ADMIN' };
const residentActor = { id: '22222222-2222-4222-8222-222222222222', role: 'RESIDENT' };

const TRANSACTION_CONTROL = ['BEGIN', 'COMMIT', 'ROLLBACK', 'SELECT set_config'];

function useFakeDatabase(handler = async () => ({ rows: [] })) {
  const fake = { statements: [], connectCount: 0, releaseCount: 0 };

  async function run(text, values) {
    fake.statements.push({ text, values });
    const start = text.trim();
    if (TRANSACTION_CONTROL.some((prefix) => start.startsWith(prefix))) {
      return { rows: [] };
    }
    return handler(text, values);
  }

  database.query = run;
  database.connect = async () => {
    fake.connectCount += 1;
    return {
      query: run,
      release() {
        fake.releaseCount += 1;
      }
    };
  };

  return fake;
}

const storedPolicy = {
  maxFutureBookingsPerUnit: 2,
  advanceDays: 7,
  cancellationCutoffMinutes: 120,
  allowedDurationMinutes: [60, 120]
};

function usePolicyDatabase() {
  return useFakeDatabase(async (text, values) => {
    if (text.includes('UPDATE bookings.booking_policies')) {
      return {
        rows: [
          {
            maxFutureBookingsPerUnit: values[0],
            advanceDays: values[1],
            cancellationCutoffMinutes: values[2],
            allowedDurationMinutes: values[3]
          }
        ]
      };
    }
    if (text.includes('FROM bookings.booking_policies')) {
      return { rows: [storedPolicy] };
    }
    return { rows: [] };
  });
}

function updateStatements(fake) {
  return fake.statements.filter((statement) =>
    statement.text.includes('UPDATE bookings.booking_policies')
  );
}

function fakeResponse() {
  const res = { statusCalls: [], jsonCalls: [] };
  res.status = (code) => {
    res.statusCalls.push(code);
    return res;
  };
  res.json = (body) => {
    res.jsonCalls.push(body);
    return res;
  };
  return res;
}

function fakeRequest({ user, body, requestId = 'request-c' } = {}) {
  return { auth: { user }, params: {}, body, requestId };
}

const validBody = {
  maxFutureBookingsPerUnit: 3,
  advanceDays: 14,
  cancellationCutoffMinutes: 60,
  allowedDurationMinutes: [120, 60]
};

test.after(async () => {
  await database.end();
});

test('getBookingPolicyRecord responds 200 with data and the request id', async () => {
  usePolicyDatabase();
  const res = fakeResponse();

  await getBookingPolicyRecord(fakeRequest({ user: adminActor, requestId: 'request-get' }), res);

  assert.deepEqual(res.statusCalls, [200]);
  assert.deepEqual(res.jsonCalls, [{ data: storedPolicy, requestId: 'request-get' }]);
});

test('getBookingPolicyRecord lets a resident rejection through without responding', async () => {
  const fake = usePolicyDatabase();
  const res = fakeResponse();

  await assert.rejects(
    getBookingPolicyRecord(fakeRequest({ user: residentActor }), res),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.code, 'FORBIDDEN');
      return true;
    }
  );

  assert.deepEqual(res.statusCalls, []);
  assert.deepEqual(res.jsonCalls, []);
  assert.equal(fake.statements.length, 0);
});

test('replaceBookingPolicyRecord responds 200 and saves sorted durations', async (t) => {
  t.mock.method(console, 'log', () => {});
  const fake = usePolicyDatabase();
  const res = fakeResponse();

  await replaceBookingPolicyRecord(
    fakeRequest({ user: adminActor, body: validBody, requestId: 'request-put' }),
    res
  );

  const saved = { ...validBody, allowedDurationMinutes: [60, 120] };
  assert.deepEqual(res.statusCalls, [200]);
  assert.deepEqual(res.jsonCalls, [{ data: saved, requestId: 'request-put' }]);
  assert.deepEqual(updateStatements(fake)[0].values, [3, 14, 60, [60, 120]]);
});

test('replaceBookingPolicyRecord lets a validation error through without responding', async () => {
  const fake = usePolicyDatabase();
  const res = fakeResponse();

  await assert.rejects(
    replaceBookingPolicyRecord(
      fakeRequest({ user: adminActor, body: { ...validBody, advanceDays: 91 } }),
      res
    ),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_INPUT');
      return true;
    }
  );

  assert.deepEqual(res.statusCalls, []);
  assert.deepEqual(res.jsonCalls, []);
  assert.equal(fake.statements.length, 0);
  assert.equal(fake.connectCount, 0);
});

test('replaceBookingPolicyRecord passes the request id to the service', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  usePolicyDatabase();
  const res = fakeResponse();

  await replaceBookingPolicyRecord(
    fakeRequest({ user: adminActor, body: validBody, requestId: 'request-audit' }),
    res
  );

  assert.equal(log.mock.calls.length, 1);
  const entry = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(entry.action, 'BOOKING_POLICY_UPDATE');
  assert.equal(entry.requestId, 'request-audit');
  assert.equal(entry.actorId, adminActor.id);
});
