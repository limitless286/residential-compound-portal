import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';
process.env.SERVICE_NAME = 'bookings';
process.env.AUTH_SERVICE_KEY = 'a'.repeat(64);
process.env.IDENTITY_BASE_URL = 'http://127.0.0.1:9';

const { database } = await import('../src/config/database.js');
const { requireAuthentication } = await import('../src/middleware/requireAuthentication.js');
const {
  getBookingPolicyRecord,
  replaceBookingPolicyRecord
} = await import('../src/controllers/bookingPolicyController.js');
const { default: bookingPolicyRoutes } = await import('../src/routes/bookingPolicyRoutes.js');
const { default: app } = await import('../src/app.js');

const policyPath = '/api/v1/admin/booking-policies';
const bearer = `Bearer ${'a'.repeat(64)}`;
const userId = '11111111-1111-4111-8111-111111111111';

const expectedRoutes = [
  { method: 'get', path: '/admin/booking-policies', controller: getBookingPolicyRecord },
  { method: 'put', path: '/admin/booking-policies', controller: replaceBookingPolicyRecord }
];

const adminUser = {
  userId,
  email: 'admin@example.test',
  fullName: 'Admin User',
  role: 'ADMIN',
  status: 'ACTIVE',
  unitId: null,
  buildingId: null
};

const residentUser = {
  userId: '22222222-2222-4222-8222-222222222222',
  email: 'resident@example.test',
  fullName: 'Resident User',
  role: 'RESIDENT',
  status: 'ACTIVE',
  unitId: '33333333-3333-4333-8333-333333333333',
  buildingId: '44444444-4444-4444-8444-444444444444'
};

const storedPolicy = {
  maxFutureBookingsPerUnit: 2,
  advanceDays: 7,
  cancellationCutoffMinutes: 120,
  allowedDurationMinutes: [60, 120]
};

const validBody = {
  maxFutureBookingsPerUnit: 3,
  advanceDays: 14,
  cancellationCutoffMinutes: 60,
  allowedDurationMinutes: [120, 60]
};

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

function identityReply(user, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => ({ data: user }) });
}

function useFakeFetch(t, reply) {
  return t.mock.method(globalThis, 'fetch', reply);
}

function silenceLogs(t) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
}

function registeredRoutes() {
  return bookingPolicyRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      methods: Object.keys(layer.route.methods),
      path: layer.route.path,
      handlers: layer.route.stack.map((routeLayer) => routeLayer.handle)
    }));
}

async function withServer(run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function send(baseUrl, method, path, { headers = {}, body, rawBody } = {}) {
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const requestHeaders = payload === undefined
    ? { ...headers }
    : {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      };

  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method, headers: requestHeaders }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: text ? JSON.parse(text) : null
        });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

function assertErrorResponse(response, status, code, message) {
  assert.equal(response.status, status, message);
  assert.deepEqual(Object.keys(response.body).sort(), ['error', 'requestId'], message);
  assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message'], message);
  assert.equal(response.body.error.code, code, message);
  assert.equal(response.body.requestId, response.headers['x-request-id'], message);
  assert.equal(response.headers['cache-control'], 'no-store', message);
}

function assertSuccessResponse(response, message) {
  assert.equal(response.status, 200, message);
  assert.deepEqual(Object.keys(response.body).sort(), ['data', 'requestId'], message);
  assert.equal(response.body.requestId, response.headers['x-request-id'], message);
  assert.equal(response.headers['cache-control'], 'no-store', message);
}

function assertDatabaseUntouched(fake, message) {
  assert.equal(fake.connectCount, 0, message);
  assert.equal(fake.statements.length, 0, message);
}

const bothRequests = [
  { method: 'GET' },
  { method: 'PUT', body: validBody }
];

test.after(async () => {
  await database.end();
});

test('booking policy router registers exactly the two routes', (t) => {
  useFakeFetch(t, identityReply(adminUser));

  assert.equal(bookingPolicyRoutes.stack.length, 2);
  assert.deepEqual(
    registeredRoutes().map((route) => ({ methods: route.methods, path: route.path })),
    expectedRoutes.map((route) => ({ methods: [route.method], path: route.path }))
  );
});

test('each booking policy route has four handlers ending with its controller', (t) => {
  useFakeFetch(t, identityReply(adminUser));
  const routes = registeredRoutes();

  expectedRoutes.forEach((expected, index) => {
    const handlers = routes[index].handlers;
    assert.equal(handlers.length, 4);
    assert.equal(handlers[0].name, 'noStore');
    assert.equal(handlers[1], requireAuthentication);
    assert.equal(handlers[3], expected.controller);
  });
});

const guardCases = [
  { name: 'ADMIN', auth: { user: { id: userId, role: 'ADMIN' } }, expect: 'allowed' },
  { name: 'RESIDENT', auth: { user: { id: userId, role: 'RESIDENT' } }, expect: 'rejected' },
  { name: 'MANAGER', auth: { user: { id: userId, role: 'MANAGER' } }, expect: 'rejected' },
  { name: 'lowercase admin', auth: { user: { id: userId, role: 'admin' } }, expect: 'rejected' },
  { name: 'empty role', auth: { user: { id: userId, role: '' } }, expect: 'rejected' },
  { name: 'no role', auth: { user: { id: userId } }, expect: 'rejected' },
  { name: 'no auth', auth: undefined, expect: 'unauthenticated' },
  { name: 'no user', auth: {}, expect: 'unauthenticated' }
];

for (const expected of expectedRoutes) {
  const label = `${expected.method.toUpperCase()} ${expected.path}`;

  test(`${label} role guard allows only ADMIN`, (t) => {
    useFakeFetch(t, identityReply(adminUser));
    const route = registeredRoutes().find(
      (candidate) => candidate.path === expected.path && candidate.methods.includes(expected.method)
    );
    const guard = route.handlers[2];

    for (const testCase of guardCases) {
      const message = `${label} - ${testCase.name}`;
      const req = testCase.auth === undefined ? {} : { auth: testCase.auth };
      let nextCalls = 0;
      const next = () => {
        nextCalls += 1;
      };

      if (testCase.expect === 'allowed') {
        assert.doesNotThrow(() => guard(req, {}, next), message);
        assert.equal(nextCalls, 1, message);
        continue;
      }

      const status = testCase.expect === 'rejected' ? 403 : 401;
      const code = testCase.expect === 'rejected' ? 'FORBIDDEN' : 'UNAUTHORIZED';
      assert.throws(
        () => guard(req, {}, next),
        (error) => {
          assert.equal(error.status, status, message);
          assert.equal(error.code, code, message);
          return true;
        },
        message
      );
      assert.equal(nextCalls, 0, message);
    }
  });
}

test('an admin session can read and replace the booking policy', async (t) => {
  silenceLogs(t);
  useFakeFetch(t, identityReply(adminUser));
  const fake = usePolicyDatabase();

  await withServer(async (baseUrl) => {
    const read = await send(baseUrl, 'GET', policyPath, { headers: { Authorization: bearer } });
    assertSuccessResponse(read, 'admin GET');
    assert.deepEqual(read.body.data, storedPolicy);

    const replaced = await send(baseUrl, 'PUT', policyPath, {
      headers: { Authorization: bearer },
      body: validBody
    });
    assertSuccessResponse(replaced, 'admin PUT');
    assert.deepEqual(replaced.body.data, { ...validBody, allowedDurationMinutes: [60, 120] });
  });

  assert.deepEqual(updateStatements(fake)[0].values, [3, 14, 60, [60, 120]]);
});

test('a resident session is refused on both routes without touching the database', async (t) => {
  silenceLogs(t);
  useFakeFetch(t, identityReply(residentUser));
  const fake = usePolicyDatabase();

  await withServer(async (baseUrl) => {
    for (const request of bothRequests) {
      const response = await send(baseUrl, request.method, policyPath, {
        headers: { Authorization: bearer },
        body: request.body
      });
      assertErrorResponse(response, 403, 'FORBIDDEN', `resident ${request.method}`);
    }
  });

  assertDatabaseUntouched(fake, 'resident');
});

test('requests without a session get 401 and never call identity', async (t) => {
  silenceLogs(t);
  const fetchMock = useFakeFetch(t, identityReply(adminUser));
  const fake = usePolicyDatabase();

  await withServer(async (baseUrl) => {
    for (const request of bothRequests) {
      const response = await send(baseUrl, request.method, policyPath, { body: request.body });
      assertErrorResponse(response, 401, 'UNAUTHORIZED', `no session ${request.method}`);
    }
  });

  assert.equal(fetchMock.mock.calls.length, 0);
  assertDatabaseUntouched(fake, 'no session');
});

for (const identityStatus of [500, 403]) {
  test(`identity ${identityStatus} with a valid admin body gives 503 on both routes`, async (t) => {
    silenceLogs(t);
    useFakeFetch(t, identityReply(adminUser, { ok: false, status: identityStatus }));
    const fake = usePolicyDatabase();

    await withServer(async (baseUrl) => {
      for (const request of bothRequests) {
        const response = await send(baseUrl, request.method, policyPath, {
          headers: { Authorization: bearer },
          body: request.body
        });
        assertErrorResponse(
          response,
          503,
          'AUTH_UNAVAILABLE',
          `identity ${identityStatus} ${request.method}`
        );
      }
    });

    assertDatabaseUntouched(fake, `identity ${identityStatus}`);
  });
}

test('admin PUT with an invalid body gets 400 INVALID_INPUT without touching the database', async (t) => {
  silenceLogs(t);
  useFakeFetch(t, identityReply(adminUser));
  const fake = usePolicyDatabase();
  const withoutAdvanceDays = { ...validBody };
  delete withoutAdvanceDays.advanceDays;
  const cases = [
    { name: 'unknown field', body: { ...validBody, extra: 1 } },
    { name: 'missing field', body: withoutAdvanceDays },
    { name: 'advanceDays 91', body: { ...validBody, advanceDays: 91 } },
    { name: 'durations [14]', body: { ...validBody, allowedDurationMinutes: [14] } },
    { name: 'JSON array body', body: [validBody] }
  ];

  await withServer(async (baseUrl) => {
    for (const testCase of cases) {
      const response = await send(baseUrl, 'PUT', policyPath, {
        headers: { Authorization: bearer },
        body: testCase.body
      });
      assertErrorResponse(response, 400, 'INVALID_INPUT', testCase.name);
    }
  });

  assertDatabaseUntouched(fake, 'invalid bodies');
});

test('admin PUT with invalid JSON text gets 400 INVALID_JSON without touching the database', async (t) => {
  silenceLogs(t);
  useFakeFetch(t, identityReply(adminUser));
  const fake = usePolicyDatabase();

  await withServer(async (baseUrl) => {
    const response = await send(baseUrl, 'PUT', policyPath, {
      headers: { Authorization: bearer },
      rawBody: '{"advanceDays":'
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_JSON');
    assert.equal(response.body.requestId, response.headers['x-request-id']);
  });

  assertDatabaseUntouched(fake, 'invalid JSON');
});
