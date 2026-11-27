import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';

const { database } = await import('../src/config/database.js');
const {
  createFacilityRecord,
  editFacilityRecord,
  listFacilityRecords,
  replaceOpeningHoursRecord
} = await import('../src/controllers/facilityController.js');

const id = '55555555-5555-4555-8555-555555555555';
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

function kindOf(text) {
  if (text.includes('FOR UPDATE')) {
    return 'LOCK';
  }
  if (text.includes('INSERT INTO bookings.facilities')) {
    return 'INSERT FACILITY';
  }
  if (text.includes('UPDATE bookings.facilities')) {
    return 'UPDATE';
  }
  if (text.includes('INSERT INTO bookings.opening_hours')) {
    return 'INSERT HOURS';
  }
  if (text.includes('DELETE FROM bookings.opening_hours')) {
    return 'DELETE HOURS';
  }
  if (text.includes('FROM bookings.opening_hours')) {
    return 'HOURS';
  }
  if (text.includes('FROM bookings.facilities')) {
    return 'FACILITIES';
  }
  return 'OTHER';
}

function statementsOfKind(fake, kind) {
  return fake.statements.filter((statement) => kindOf(statement.text) === kind);
}

function byKind(responses) {
  return async (text) => responses[kindOf(text)] ?? { rows: [] };
}

function facilityRow(overrides = {}) {
  return {
    id,
    name: 'Pool',
    description: '',
    locationDescription: 'Block A',
    status: 'ACTIVE',
    createdAt: new Date('2026-11-01T08:00:00Z'),
    updatedAt: new Date('2026-11-01T08:00:00Z'),
    ...overrides
  };
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

function fakeRequest({ user, params = {}, body, requestId = 'request-c' } = {}) {
  return { auth: { user }, params, body, requestId };
}

const hours = [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '22:00' }];

test.after(async () => {
  await database.end();
});

test('listFacilityRecords responds 200 with data and the request id', async () => {
  const row = facilityRow();
  useFakeDatabase(byKind({ FACILITIES: { rows: [row] }, HOURS: { rows: hours } }));
  const req = fakeRequest({ user: residentActor, requestId: 'request-list' });
  const res = fakeResponse();

  await listFacilityRecords(req, res);

  assert.deepEqual(res.statusCalls, [200]);
  assert.deepEqual(res.jsonCalls, [
    { data: [{ ...row, openingHours: hours }], requestId: 'request-list' }
  ]);
});

test('createFacilityRecord responds 201 and passes actor, body and request id', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const row = facilityRow();
  const fake = useFakeDatabase(byKind({ 'INSERT FACILITY': { rows: [row] } }));
  const req = fakeRequest({
    user: adminActor,
    body: { name: 'Pool', locationDescription: 'Block A' },
    requestId: 'request-create'
  });
  const res = fakeResponse();

  await createFacilityRecord(req, res);

  assert.deepEqual(res.statusCalls, [201]);
  assert.deepEqual(res.jsonCalls, [
    { data: { ...row, openingHours: [] }, requestId: 'request-create' }
  ]);
  assert.deepEqual(statementsOfKind(fake, 'INSERT FACILITY')[0].values, ['Pool', '', 'Block A']);
  const logEntry = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(logEntry.actorId, adminActor.id);
  assert.equal(logEntry.requestId, 'request-create');
});

test('editFacilityRecord responds 200 and uses the id from req.params', async (t) => {
  t.mock.method(console, 'log', () => {});
  const updatedRow = facilityRow({ name: 'New name' });
  const fake = useFakeDatabase(byKind({
    LOCK: { rows: [facilityRow()] },
    UPDATE: { rows: [updatedRow] },
    HOURS: { rows: hours }
  }));
  const req = fakeRequest({
    user: adminActor,
    params: { id },
    body: { name: 'New name' },
    requestId: 'request-edit'
  });
  const res = fakeResponse();

  await editFacilityRecord(req, res);

  assert.deepEqual(res.statusCalls, [200]);
  assert.deepEqual(res.jsonCalls, [
    { data: { ...updatedRow, openingHours: hours }, requestId: 'request-edit' }
  ]);
  assert.deepEqual(statementsOfKind(fake, 'LOCK')[0].values, [id]);
  assert.deepEqual(statementsOfKind(fake, 'UPDATE')[0].values, [id, 'New name', null, null, null]);
});

test('replaceOpeningHoursRecord responds 200 and uses the id from req.params', async (t) => {
  t.mock.method(console, 'log', () => {});
  const lockedRow = facilityRow();
  const fake = useFakeDatabase(byKind({ LOCK: { rows: [lockedRow] }, HOURS: { rows: hours } }));
  const req = fakeRequest({
    user: adminActor,
    params: { id },
    body: { openingHours: [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '22:00' }] },
    requestId: 'request-hours'
  });
  const res = fakeResponse();

  await replaceOpeningHoursRecord(req, res);

  assert.deepEqual(res.statusCalls, [200]);
  assert.deepEqual(res.jsonCalls, [
    { data: { ...lockedRow, openingHours: hours }, requestId: 'request-hours' }
  ]);
  assert.deepEqual(statementsOfKind(fake, 'LOCK')[0].values, [id]);
  assert.deepEqual(statementsOfKind(fake, 'INSERT HOURS')[0].values, [id, 1, '08:00', '22:00']);
});

test('a service rejection propagates and no response is sent', async () => {
  const fake = useFakeDatabase();
  const req = fakeRequest({
    user: residentActor,
    body: { name: 'Pool', locationDescription: 'Block A' }
  });
  const res = fakeResponse();

  await assert.rejects(createFacilityRecord(req, res), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'FORBIDDEN');
    return true;
  });

  assert.deepEqual(res.statusCalls, []);
  assert.deepEqual(res.jsonCalls, []);
  assert.equal(fake.connectCount, 0);
});
