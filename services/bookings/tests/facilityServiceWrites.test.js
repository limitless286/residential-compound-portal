import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';

const { database } = await import('../src/config/database.js');
const { editFacility, replaceFacilityOpeningHours } = await import(
  '../src/services/facilityService.js'
);

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
  const start = text.trim();
  if (start.startsWith('BEGIN')) {
    return 'BEGIN';
  }
  if (start.startsWith('COMMIT')) {
    return 'COMMIT';
  }
  if (start.startsWith('ROLLBACK')) {
    return 'ROLLBACK';
  }
  if (start.startsWith('SELECT set_config')) {
    return 'SET LOCK TIMEOUT';
  }
  if (text.includes('FOR UPDATE')) {
    return 'LOCK';
  }
  if (text.includes('UPDATE bookings.facilities')) {
    return 'UPDATE';
  }
  if (text.includes('DELETE FROM bookings.opening_hours')) {
    return 'DELETE HOURS';
  }
  if (text.includes('INSERT INTO bookings.opening_hours')) {
    return 'INSERT HOURS';
  }
  if (text.includes('FROM bookings.opening_hours')) {
    return 'HOURS';
  }
  return 'OTHER';
}

function statementKinds(fake) {
  return fake.statements.map((statement) => kindOf(statement.text));
}

function statementsOfKind(fake, kind) {
  return fake.statements.filter((statement) => kindOf(statement.text) === kind);
}

function byKind(responses) {
  return async (text) => {
    const response = responses[kindOf(text)];
    if (typeof response === 'function') {
      return response();
    }
    return response ?? { rows: [] };
  };
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

function rejectsWith(status, code) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}

const hours = [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '22:00' }];

function entry(dayOfWeek, opensAt = '08:00', closesAt = '22:00') {
  return { dayOfWeek, opensAt, closesAt };
}

test.after(async () => {
  await database.end();
});

test('editFacility locks the facility before updating', async () => {
  const row = facilityRow();
  const updatedRow = facilityRow({ name: 'New name' });
  const fake = useFakeDatabase(byKind({
    LOCK: { rows: [row] },
    UPDATE: { rows: [updatedRow] },
    HOURS: { rows: hours }
  }));

  const result = await editFacility(adminActor, id, { name: 'New name' }, 'request-1');

  assert.deepEqual(statementKinds(fake), [
    'BEGIN',
    'SET LOCK TIMEOUT',
    'LOCK',
    'UPDATE',
    'HOURS',
    'COMMIT'
  ]);
  assert.deepEqual(statementsOfKind(fake, 'LOCK')[0].values, [id]);
  assert.deepEqual(statementsOfKind(fake, 'UPDATE')[0].values, [id, 'New name', null, null, null]);
  assert.deepEqual(result, { ...updatedRow, openingHours: hours });
});

test('editFacility passes every editable field trimmed', async () => {
  const fake = useFakeDatabase(byKind({
    LOCK: { rows: [facilityRow()] },
    UPDATE: { rows: [facilityRow()] }
  }));

  await editFacility(
    adminActor,
    id,
    { name: ' N ', description: '', locationDescription: ' L ', status: 'INACTIVE' },
    'request-2'
  );

  assert.deepEqual(statementsOfKind(fake, 'UPDATE')[0].values, [id, 'N', '', 'L', 'INACTIVE']);
});

test('editFacility rejects invalid input without touching the database', async () => {
  const fake = useFakeDatabase();
  const cases = [
    ['not-a-uuid', { name: 'Pool' }],
    [id, null],
    [id, []],
    [id, {}],
    [id, { color: 'red' }],
    [id, { name: null }],
    [id, { name: '' }],
    [id, { name: 'a'.repeat(101) }],
    [id, { description: 'd'.repeat(1001) }],
    [id, { description: 5 }],
    [id, { description: null }],
    [id, { locationDescription: null }],
    [id, { locationDescription: '  ' }],
    [id, { status: 'CLOSED' }],
    [id, { status: null }],
    [id, { status: 'active' }]
  ];

  for (const [facilityId, body] of cases) {
    await assert.rejects(
      editFacility(adminActor, facilityId, body, 'request-3'),
      rejectsWith(400, 'INVALID_INPUT')
    );
  }

  assert.equal(fake.connectCount, 0);
});

test('editFacility returns 404 for an unknown facility and rolls back', async () => {
  const fake = useFakeDatabase(byKind({ LOCK: { rows: [] } }));

  await assert.rejects(
    editFacility(adminActor, id, { name: 'New name' }, 'request-4'),
    rejectsWith(404, 'FACILITY_NOT_FOUND')
  );

  assert.equal(statementKinds(fake).includes('ROLLBACK'), true);
  assert.equal(statementKinds(fake).includes('UPDATE'), false);
});

test('editFacility rejects non-admins and missing actors', async () => {
  const fake = useFakeDatabase();

  await assert.rejects(
    editFacility(residentActor, id, { name: 'New name' }, 'request-5'),
    rejectsWith(403, 'FORBIDDEN')
  );
  await assert.rejects(
    editFacility(undefined, id, { name: 'New name' }, 'request-5'),
    rejectsWith(401, 'UNAUTHORIZED')
  );

  assert.equal(fake.connectCount, 0);
});

test('editFacility logs one success line with field names only', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  useFakeDatabase(byKind({
    LOCK: { rows: [facilityRow()] },
    UPDATE: { rows: [facilityRow({ name: 'Secret Name' })] }
  }));

  await editFacility(adminActor, id, { name: 'Secret Name' }, 'request-6');

  assert.equal(log.mock.calls.length, 1);
  const line = log.mock.calls[0].arguments[0];
  const logEntry = JSON.parse(line);
  assert.equal(logEntry.action, 'FACILITY_UPDATE');
  assert.equal(logEntry.outcome, 'SUCCESS');
  assert.deepEqual(logEntry.changedFields, ['name']);
  assert.equal(logEntry.requestId, 'request-6');
  assert.equal(line.includes('Secret Name'), false);
});

test('editFacility maps a lock timeout to 503 SERVICE_BUSY', async () => {
  const fake = useFakeDatabase(byKind({
    LOCK: () => {
      throw { code: '55P03' };
    }
  }));

  await assert.rejects(
    editFacility(adminActor, id, { name: 'New name' }, 'request-7'),
    rejectsWith(503, 'SERVICE_BUSY')
  );

  assert.equal(statementKinds(fake).includes('ROLLBACK'), true);
  assert.equal(statementKinds(fake).includes('UPDATE'), false);
});

test('replaceFacilityOpeningHours replaces the schedule under the facility lock', async () => {
  const lockedRow = facilityRow();
  const fake = useFakeDatabase(byKind({
    LOCK: { rows: [lockedRow] },
    'DELETE HOURS': { rows: [], rowCount: 1 },
    HOURS: { rows: hours }
  }));

  const result = await replaceFacilityOpeningHours(
    adminActor,
    id,
    { openingHours: [entry(3, '09:00', '18:00'), entry(1, '08:00', '22:00')] },
    'request-8'
  );

  assert.deepEqual(statementKinds(fake), [
    'BEGIN',
    'SET LOCK TIMEOUT',
    'LOCK',
    'DELETE HOURS',
    'INSERT HOURS',
    'INSERT HOURS',
    'HOURS',
    'COMMIT'
  ]);
  assert.deepEqual(
    statementsOfKind(fake, 'INSERT HOURS').map((statement) => statement.values),
    [
      [id, 1, '08:00', '22:00'],
      [id, 3, '09:00', '18:00']
    ]
  );
  assert.deepEqual(result, { ...lockedRow, openingHours: hours });
});

test('replaceFacilityOpeningHours accepts an empty schedule', async () => {
  const fake = useFakeDatabase(byKind({ LOCK: { rows: [facilityRow()] } }));

  await replaceFacilityOpeningHours(adminActor, id, { openingHours: [] }, 'request-9');

  assert.deepEqual(statementKinds(fake), [
    'BEGIN',
    'SET LOCK TIMEOUT',
    'LOCK',
    'DELETE HOURS',
    'HOURS',
    'COMMIT'
  ]);
});

test('replaceFacilityOpeningHours rejects invalid schedules without touching the database', async () => {
  const fake = useFakeDatabase();
  const eightEntries = [0, 1, 2, 3, 4, 5, 6, 0].map((day) => entry(day));
  const cases = [
    ['not-a-uuid', { openingHours: [] }],
    [id, null],
    [id, {}],
    [id, { openingHours: 'x' }],
    [id, { openingHours: null }],
    [id, { openingHours: [], extra: 1 }],
    [id, { openingHours: eightEntries }],
    [id, { openingHours: [5] }],
    [id, { openingHours: [{ ...entry(1), note: 'x' }] }],
    [id, { openingHours: [entry(-1)] }],
    [id, { openingHours: [entry(7)] }],
    [id, { openingHours: [entry(1.5)] }],
    [id, { openingHours: [entry('1')] }],
    [id, { openingHours: [entry(1, '8:00')] }],
    [id, { openingHours: [entry(1, '24:00')] }],
    [id, { openingHours: [entry(1, '08:60')] }],
    [id, { openingHours: [entry(1, 800)] }],
    [id, { openingHours: [entry(1, '08:00', '24:00')] }],
    [id, { openingHours: [{ dayOfWeek: 1, opensAt: '08:00' }] }],
    [id, { openingHours: [{ dayOfWeek: 1, closesAt: '22:00' }] }],
    [id, { openingHours: [entry(1, '08:00', '08:00')] }],
    [id, { openingHours: [entry(1, '18:00', '09:00')] }],
    [id, { openingHours: [entry(2), entry(2)] }]
  ];

  for (const [facilityId, body] of cases) {
    await assert.rejects(
      replaceFacilityOpeningHours(adminActor, facilityId, body, 'request-10'),
      rejectsWith(400, 'INVALID_INPUT')
    );
  }

  assert.equal(fake.connectCount, 0);
});

test('replaceFacilityOpeningHours returns 404 for an unknown facility', async () => {
  const fake = useFakeDatabase(byKind({ LOCK: { rows: [] } }));

  await assert.rejects(
    replaceFacilityOpeningHours(adminActor, id, { openingHours: [entry(1)] }, 'request-11'),
    rejectsWith(404, 'FACILITY_NOT_FOUND')
  );

  assert.equal(statementKinds(fake).includes('ROLLBACK'), true);
  assert.equal(statementKinds(fake).includes('DELETE HOURS'), false);
});

test('replaceFacilityOpeningHours rejects non-admins and missing actors', async () => {
  const fake = useFakeDatabase();

  await assert.rejects(
    replaceFacilityOpeningHours(residentActor, id, { openingHours: [] }, 'request-12'),
    rejectsWith(403, 'FORBIDDEN')
  );
  await assert.rejects(
    replaceFacilityOpeningHours(undefined, id, { openingHours: [] }, 'request-12'),
    rejectsWith(401, 'UNAUTHORIZED')
  );

  assert.equal(fake.connectCount, 0);
});

test('replaceFacilityOpeningHours logs one success line with the day count', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  useFakeDatabase(byKind({ LOCK: { rows: [facilityRow()] } }));

  await replaceFacilityOpeningHours(
    adminActor,
    id,
    { openingHours: [entry(1), entry(2)] },
    'request-13'
  );

  assert.equal(log.mock.calls.length, 1);
  const logEntry = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(logEntry.action, 'FACILITY_HOURS_REPLACE');
  assert.equal(logEntry.outcome, 'SUCCESS');
  assert.equal(logEntry.dayCount, 2);
  assert.equal(logEntry.requestId, 'request-13');
});

test('replaceFacilityOpeningHours maps a deadlock during insert to 503 SERVICE_BUSY', async () => {
  const fake = useFakeDatabase(byKind({
    LOCK: { rows: [facilityRow()] },
    'INSERT HOURS': () => {
      throw { code: '40P01' };
    }
  }));

  await assert.rejects(
    replaceFacilityOpeningHours(adminActor, id, { openingHours: [entry(1)] }, 'request-14'),
    rejectsWith(503, 'SERVICE_BUSY')
  );

  assert.equal(statementKinds(fake).includes('ROLLBACK'), true);
});
