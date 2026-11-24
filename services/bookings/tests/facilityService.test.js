import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';

const { database } = await import('../src/config/database.js');
const { listFacilities, createFacility } = await import('../src/services/facilityService.js');

const facilityId = '55555555-5555-4555-8555-555555555555';
const otherFacilityId = '66666666-6666-4666-8666-666666666666';
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

function statementStarts(fake) {
  return fake.statements.map((statement) => {
    const start = statement.text.trim();
    if (start.startsWith('SELECT set_config')) {
      return 'SELECT set_config';
    }
    if (start.startsWith('INSERT INTO bookings.facilities')) {
      return 'INSERT INTO bookings.facilities';
    }
    return start.split(/\s+/)[0];
  });
}

function findStatement(fake, fragment) {
  return fake.statements.find((statement) => statement.text.includes(fragment));
}

function facilityRow(id, name) {
  return {
    id,
    name,
    description: '',
    locationDescription: 'Block A',
    status: 'ACTIVE',
    createdAt: new Date('2026-11-01T08:00:00Z'),
    updatedAt: new Date('2026-11-01T08:00:00Z')
  };
}

function rejectsWith(status, code) {
  return (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}

test.after(async () => {
  await database.end();
});

test('listFacilities shows residents active facilities with opening hours', async () => {
  const gym = facilityRow(facilityId, 'Gym');
  const pool = facilityRow(otherFacilityId, 'Pool');
  const gymHours = [{ dayOfWeek: 1, opensAt: '06:00', closesAt: '22:00' }];
  const poolHours = [{ dayOfWeek: 6, opensAt: '09:00', closesAt: '18:00' }];
  const fake = useFakeDatabase(async (text, values) => {
    if (text.includes('bookings.opening_hours')) {
      return { rows: values[0] === facilityId ? gymHours : poolHours };
    }
    return { rows: [gym, pool] };
  });

  const result = await listFacilities(residentActor);

  assert.deepEqual(findStatement(fake, 'FROM bookings.facilities').values, [true]);
  assert.deepEqual(result, [
    { ...gym, openingHours: gymHours },
    { ...pool, openingHours: poolHours }
  ]);
  assert.equal(fake.connectCount, 0);
});

test('listFacilities shows admins every facility', async () => {
  const fake = useFakeDatabase(async () => ({ rows: [] }));

  const result = await listFacilities(adminActor);

  assert.deepEqual(findStatement(fake, 'FROM bookings.facilities').values, [false]);
  assert.deepEqual(result, []);
});

test('listFacilities rejects a missing actor and an unknown role', async () => {
  const fake = useFakeDatabase();

  await assert.rejects(listFacilities(undefined), rejectsWith(401, 'UNAUTHORIZED'));
  await assert.rejects(listFacilities({ role: 'GUEST' }), rejectsWith(403, 'FORBIDDEN'));

  assert.equal(fake.statements.length, 0);
});

test('createFacility inserts trimmed values in one transaction without a lock', async () => {
  const row = facilityRow(facilityId, 'Pool');
  const fake = useFakeDatabase(async () => ({ rows: [row] }));

  const result = await createFacility(
    adminActor,
    { name: '  Pool  ', description: ' Outdoor ', locationDescription: ' Block A ' },
    'request-1'
  );

  assert.deepEqual(statementStarts(fake), [
    'BEGIN',
    'SELECT set_config',
    'INSERT INTO bookings.facilities',
    'COMMIT'
  ]);
  assert.equal(fake.statements.some((statement) => statement.text.includes('FOR UPDATE')), false);
  assert.deepEqual(
    findStatement(fake, 'INSERT INTO bookings.facilities').values,
    ['Pool', 'Outdoor', 'Block A']
  );
  assert.deepEqual(result, { ...row, openingHours: [] });
  assert.equal(fake.connectCount, 1);
  assert.equal(fake.releaseCount, 1);
});

test('createFacility defaults description to an empty string', async () => {
  const fake = useFakeDatabase(async () => ({ rows: [facilityRow(facilityId, 'Pool')] }));

  await createFacility(adminActor, { name: 'Pool', locationDescription: 'Block A' }, 'request-2');

  assert.equal(findStatement(fake, 'INSERT INTO bookings.facilities').values[1], '');
});

test('createFacility rejects non-admins without touching the database', async () => {
  const fake = useFakeDatabase();

  await assert.rejects(
    createFacility(residentActor, { name: 'Pool', locationDescription: 'Block A' }, 'request-3'),
    rejectsWith(403, 'FORBIDDEN')
  );

  assert.equal(fake.connectCount, 0);
  assert.equal(fake.statements.length, 0);
});

test('createFacility rejects invalid bodies without touching the database', async () => {
  const fake = useFakeDatabase();
  const bodies = [
    null,
    [],
    { name: 'A', locationDescription: 'B', color: 'red' },
    { locationDescription: 'Block A' },
    { name: '   ', locationDescription: 'Block A' },
    { name: 'a'.repeat(101), locationDescription: 'Block A' },
    { name: 'Pool' },
    { name: 'Pool', locationDescription: 'b'.repeat(201) },
    { name: 'Pool', locationDescription: 'Block A', description: 'd'.repeat(1001) },
    { name: 'Pool', locationDescription: 'Block A', description: 5 },
    { name: 7, locationDescription: 'Block A' }
  ];

  for (const body of bodies) {
    await assert.rejects(
      createFacility(adminActor, body, 'request-4'),
      rejectsWith(400, 'INVALID_INPUT')
    );
  }

  assert.equal(fake.connectCount, 0);
  assert.equal(fake.statements.length, 0);
});

test('createFacility logs one success line with ids only', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  useFakeDatabase(async () => ({ rows: [facilityRow(facilityId, 'Secret Pool')] }));

  await createFacility(
    adminActor,
    { name: 'Secret Pool', locationDescription: 'Block A' },
    'request-5'
  );

  assert.equal(log.mock.calls.length, 1);
  const line = log.mock.calls[0].arguments[0];
  const entry = JSON.parse(line);
  assert.equal(entry.service, 'bookings');
  assert.equal(entry.action, 'FACILITY_CREATE');
  assert.equal(entry.outcome, 'SUCCESS');
  assert.equal(entry.requestId, 'request-5');
  assert.equal(entry.actorId, adminActor.id);
  assert.equal(entry.facilityId, facilityId);
  assert.equal(line.includes('Secret Pool'), false);
});

test('createFacility maps a deadlock to 503 SERVICE_BUSY', async () => {
  const fake = useFakeDatabase(async () => {
    throw { code: '40P01' };
  });

  await assert.rejects(
    createFacility(adminActor, { name: 'Pool', locationDescription: 'Block A' }, 'request-6'),
    rejectsWith(503, 'SERVICE_BUSY')
  );

  assert.equal(statementStarts(fake).includes('ROLLBACK'), true);
});
