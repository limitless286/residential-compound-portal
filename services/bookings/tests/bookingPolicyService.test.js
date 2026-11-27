import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';

const { database } = await import('../src/config/database.js');
const { getBookingPolicy, replaceBookingPolicy } = await import(
  '../src/services/bookingPolicyService.js'
);

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

function statementTexts(fake) {
  return fake.statements.map((statement) => statement.text.trim());
}

function updateStatements(fake) {
  return fake.statements.filter((statement) =>
    statement.text.includes('UPDATE bookings.booking_policies')
  );
}

function policyRow(overrides = {}) {
  return {
    maxFutureBookingsPerUnit: 3,
    advanceDays: 14,
    cancellationCutoffMinutes: 60,
    allowedDurationMinutes: [60, 120],
    ...overrides
  };
}

function returningPolicy() {
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
    return { rows: [policyRow()] };
  });
}

function validBody(overrides = {}) {
  return {
    maxFutureBookingsPerUnit: 3,
    advanceDays: 14,
    cancellationCutoffMinutes: 60,
    allowedDurationMinutes: [120, 60],
    ...overrides
  };
}

function withoutField(field) {
  const body = validBody();
  delete body[field];
  return body;
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

test('getBookingPolicy returns the policy to admins only', async () => {
  const fake = useFakeDatabase(async () => ({ rows: [policyRow()] }));

  const policy = await getBookingPolicy(adminActor);

  assert.deepEqual(policy, policyRow());
  assert.equal(fake.statements.length, 1);
  assert.equal(fake.statements[0].text.includes('FROM bookings.booking_policies'), true);

  const refused = useFakeDatabase(async () => ({ rows: [policyRow()] }));
  await assert.rejects(getBookingPolicy(residentActor), rejectsWith(403, 'FORBIDDEN'));
  await assert.rejects(getBookingPolicy(undefined), rejectsWith(401, 'UNAUTHORIZED'));
  assert.equal(refused.statements.length, 0);
  assert.equal(refused.connectCount, 0);
});

test('replaceBookingPolicy saves a valid policy in one unlocked update', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const fake = returningPolicy();

  const result = await replaceBookingPolicy(adminActor, validBody(), 'request-policy');

  assert.deepEqual(result, {
    maxFutureBookingsPerUnit: 3,
    advanceDays: 14,
    cancellationCutoffMinutes: 60,
    allowedDurationMinutes: [60, 120]
  });
  assert.equal(updateStatements(fake).length, 1);
  assert.deepEqual(updateStatements(fake)[0].values, [3, 14, 60, [60, 120]]);

  const texts = statementTexts(fake);
  assert.equal(texts.some((text) => text.includes('FOR UPDATE')), false);
  assert.equal(texts.some((text) => text.includes('pg_advisory')), false);
  assert.equal(texts.filter((text) => text === 'BEGIN').length, 1);
  assert.equal(texts.filter((text) => text === 'COMMIT').length, 1);
  assert.equal(texts.some((text) => text.startsWith('SELECT') && !text.includes('set_config')), false);

  assert.equal(log.mock.calls.length, 1);
  const line = log.mock.calls[0].arguments[0];
  const entry = JSON.parse(line);
  assert.equal(entry.action, 'BOOKING_POLICY_UPDATE');
  assert.equal(entry.outcome, 'SUCCESS');
  assert.equal(entry.actorId, adminActor.id);
  assert.equal(entry.requestId, 'request-policy');
  assert.deepEqual(
    Object.keys(entry).sort(),
    ['action', 'actorId', 'outcome', 'requestId', 'service', 'timestamp']
  );
  for (const field of [
    'maxFutureBookingsPerUnit',
    'advanceDays',
    'cancellationCutoffMinutes',
    'allowedDurationMinutes'
  ]) {
    assert.equal(line.includes(field), false, `log must not contain ${field}`);
  }
});

test('replaceBookingPolicy saves durations sorted and leaves the input unchanged', async (t) => {
  t.mock.method(console, 'log', () => {});
  const fake = returningPolicy();
  const durations = [120, 60];

  await replaceBookingPolicy(
    adminActor,
    validBody({ allowedDurationMinutes: durations }),
    'request-sort'
  );

  assert.deepEqual(updateStatements(fake)[0].values[3], [60, 120]);
  assert.notEqual(updateStatements(fake)[0].values[3], durations);
  assert.deepEqual(durations, [120, 60]);
});

test('replaceBookingPolicy refuses residents and missing actors', async () => {
  const fake = returningPolicy();

  await assert.rejects(
    replaceBookingPolicy(residentActor, validBody(), 'request-r'),
    rejectsWith(403, 'FORBIDDEN')
  );
  await assert.rejects(
    replaceBookingPolicy(undefined, validBody(), 'request-r'),
    rejectsWith(401, 'UNAUTHORIZED')
  );

  assert.equal(fake.statements.length, 0);
  assert.equal(fake.connectCount, 0);
});

const invalidCases = [
  { name: 'body null', body: null },
  { name: 'body array', body: [] },
  { name: 'body string', body: 'policy' },
  { name: 'unknown field', body: validBody({ extra: 1 }) },
  { name: 'missing maxFutureBookingsPerUnit', body: withoutField('maxFutureBookingsPerUnit') },
  { name: 'missing advanceDays', body: withoutField('advanceDays') },
  { name: 'missing cancellationCutoffMinutes', body: withoutField('cancellationCutoffMinutes') },
  { name: 'missing allowedDurationMinutes', body: withoutField('allowedDurationMinutes') },
  { name: 'max 0', body: validBody({ maxFutureBookingsPerUnit: 0 }) },
  { name: 'max 11', body: validBody({ maxFutureBookingsPerUnit: 11 }) },
  { name: 'max 1.5', body: validBody({ maxFutureBookingsPerUnit: 1.5 }) },
  { name: 'max string', body: validBody({ maxFutureBookingsPerUnit: '2' }) },
  { name: 'max null', body: validBody({ maxFutureBookingsPerUnit: null }) },
  { name: 'advanceDays 0', body: validBody({ advanceDays: 0 }) },
  { name: 'advanceDays 91', body: validBody({ advanceDays: 91 }) },
  { name: 'cutoff -1', body: validBody({ cancellationCutoffMinutes: -1 }) },
  { name: 'cutoff 1441', body: validBody({ cancellationCutoffMinutes: 1441 }) },
  { name: 'durations not an array', body: validBody({ allowedDurationMinutes: 60 }) },
  { name: 'durations empty', body: validBody({ allowedDurationMinutes: [] }) },
  {
    name: 'durations 7 items',
    body: validBody({ allowedDurationMinutes: [15, 30, 45, 60, 90, 120, 180] })
  },
  { name: 'durations duplicate', body: validBody({ allowedDurationMinutes: [60, 60] }) },
  { name: 'durations 14', body: validBody({ allowedDurationMinutes: [14] }) },
  { name: 'durations 481', body: validBody({ allowedDurationMinutes: [481] }) },
  { name: 'durations 60.5', body: validBody({ allowedDurationMinutes: [60.5] }) },
  { name: 'durations string item', body: validBody({ allowedDurationMinutes: ['60'] }) },
  { name: 'durations null item', body: validBody({ allowedDurationMinutes: [null] }) }
];

test('replaceBookingPolicy rejects invalid bodies before touching the database', async () => {
  for (const testCase of invalidCases) {
    const fake = returningPolicy();

    await assert.rejects(
      replaceBookingPolicy(adminActor, testCase.body, 'request-invalid'),
      (error) => {
        assert.equal(error.status, 400, testCase.name);
        assert.equal(error.code, 'INVALID_INPUT', testCase.name);
        return true;
      },
      testCase.name
    );

    assert.equal(fake.statements.length, 0, testCase.name);
    assert.equal(fake.connectCount, 0, testCase.name);
  }
});

const boundaryCases = [
  { name: 'max 1', overrides: { maxFutureBookingsPerUnit: 1 } },
  { name: 'max 10', overrides: { maxFutureBookingsPerUnit: 10 } },
  { name: 'advanceDays 1', overrides: { advanceDays: 1 } },
  { name: 'advanceDays 90', overrides: { advanceDays: 90 } },
  { name: 'cutoff 0', overrides: { cancellationCutoffMinutes: 0 } },
  { name: 'cutoff 1440', overrides: { cancellationCutoffMinutes: 1440 } },
  { name: 'durations [15]', overrides: { allowedDurationMinutes: [15] } },
  { name: 'durations [480]', overrides: { allowedDurationMinutes: [480] } },
  {
    name: 'six distinct durations',
    overrides: { allowedDurationMinutes: [480, 15, 90, 30, 240, 60] }
  }
];

test('replaceBookingPolicy accepts boundary values', async (t) => {
  t.mock.method(console, 'log', () => {});

  for (const testCase of boundaryCases) {
    const fake = returningPolicy();
    const body = validBody(testCase.overrides);
    const expectedDurations = [...body.allowedDurationMinutes].sort((a, b) => a - b);

    const result = await replaceBookingPolicy(adminActor, body, 'request-boundary');

    assert.deepEqual(
      updateStatements(fake)[0].values,
      [
        body.maxFutureBookingsPerUnit,
        body.advanceDays,
        body.cancellationCutoffMinutes,
        expectedDurations
      ],
      testCase.name
    );
    assert.deepEqual(result.allowedDurationMinutes, expectedDurations, testCase.name);
  }
});

test('replaceBookingPolicy lets a database error through and rolls back', async () => {
  const original = new Error('connection lost');
  const fake = useFakeDatabase(async (text) => {
    if (text.includes('UPDATE bookings.booking_policies')) {
      throw original;
    }
    return { rows: [] };
  });

  await assert.rejects(replaceBookingPolicy(adminActor, validBody(), 'request-error'), (error) => {
    assert.equal(error === original, true);
    return true;
  });

  assert.equal(statementTexts(fake).includes('ROLLBACK'), true);
  assert.equal(statementTexts(fake).includes('COMMIT'), false);
});
