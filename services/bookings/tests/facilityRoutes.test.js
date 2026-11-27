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
  createFacilityRecord,
  editFacilityRecord,
  listFacilityRecords,
  replaceOpeningHoursRecord
} = await import('../src/controllers/facilityController.js');
const { default: facilityRoutes } = await import('../src/routes/facilityRoutes.js');
const { default: app } = await import('../src/app.js');

const expectedRoutes = [
  { method: 'get', path: '/facilities', controller: listFacilityRecords },
  { method: 'post', path: '/admin/facilities', controller: createFacilityRecord },
  { method: 'patch', path: '/admin/facilities/:id', controller: editFacilityRecord },
  {
    method: 'put',
    path: '/admin/facilities/:id/opening-hours',
    controller: replaceOpeningHoursRecord
  }
];

function registeredRoutes() {
  return facilityRoutes.stack
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

test.after(async () => {
  await database.end();
});

test('facility router registers exactly the four routes', () => {
  assert.equal(facilityRoutes.stack.length, 4);
  assert.deepEqual(
    registeredRoutes().map((route) => ({ methods: route.methods, path: route.path })),
    expectedRoutes.map((route) => ({ methods: [route.method], path: route.path }))
  );
});

test('each route has four handlers ending with its own controller', () => {
  const routes = registeredRoutes();

  expectedRoutes.forEach((expected, index) => {
    const handlers = routes[index].handlers;
    assert.equal(handlers.length, 4);
    assert.equal(handlers[0].name, 'noStore');
    assert.equal(handlers[1], requireAuthentication);
    assert.equal(handlers[3], expected.controller);

    for (const other of expectedRoutes) {
      if (other !== expected) {
        assert.notEqual(handlers[2], other.controller);
        assert.notEqual(handlers[3], other.controller);
      }
    }
  });
});

test('GET /api/v1/facilities without a session returns 401 without a network call', async (t) => {
  t.mock.method(console, 'error', () => {});
  const fetchMock = t.mock.method(globalThis, 'fetch');

  await withServer(async (baseUrl) => {
    const response = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/api/v1/facilities`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });

    assert.equal(response.status, 401);
    assert.equal(JSON.parse(response.body).error.code, 'UNAUTHORIZED');
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  assert.equal(fetchMock.mock.calls.length, 0);
});

test('an unknown endpoint still returns 404 NOT_FOUND', async () => {
  await withServer(async (baseUrl) => {
    const response = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/api/v1/does-not-exist`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });

    assert.equal(response.status, 404);
    assert.equal(JSON.parse(response.body).error.code, 'NOT_FOUND');
  });
});

const userId = '11111111-1111-4111-8111-111111111111';

const adminOnlyCases = [
  { name: 'ADMIN', auth: { user: { id: userId, role: 'ADMIN' } }, expect: 'allowed' },
  { name: 'RESIDENT', auth: { user: { id: userId, role: 'RESIDENT' } }, expect: 'rejected' },
  { name: 'MANAGER', auth: { user: { id: userId, role: 'MANAGER' } }, expect: 'rejected' },
  { name: 'lowercase admin', auth: { user: { id: userId, role: 'admin' } }, expect: 'rejected' },
  { name: 'empty role', auth: { user: { id: userId, role: '' } }, expect: 'rejected' },
  { name: 'no role', auth: { user: { id: userId } }, expect: 'rejected' },
  { name: 'no auth', auth: undefined, expect: 'unauthenticated' },
  { name: 'no user', auth: {}, expect: 'unauthenticated' }
];

const listCases = [
  { name: 'ADMIN', auth: { user: { id: userId, role: 'ADMIN' } }, expect: 'allowed' },
  { name: 'RESIDENT', auth: { user: { id: userId, role: 'RESIDENT' } }, expect: 'allowed' },
  { name: 'MANAGER', auth: { user: { id: userId, role: 'MANAGER' } }, expect: 'rejected' },
  { name: 'no role', auth: { user: { id: userId } }, expect: 'rejected' },
  { name: 'no auth', auth: undefined, expect: 'unauthenticated' },
  { name: 'no user', auth: {}, expect: 'unauthenticated' }
];

function roleGuardFor(method, path) {
  const route = registeredRoutes().find(
    (candidate) => candidate.path === path && candidate.methods.includes(method)
  );
  assert.ok(route, `route ${method.toUpperCase()} ${path} is registered`);
  return route.handlers[2];
}

function checkGuard(guard, label, testCase) {
  const message = `${label} - ${testCase.name}`;
  const req = testCase.auth === undefined ? {} : { auth: testCase.auth };
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  if (testCase.expect === 'allowed') {
    assert.doesNotThrow(() => guard(req, {}, next), message);
    assert.equal(nextCalls, 1, message);
    return;
  }

  const expected = testCase.expect === 'rejected'
    ? { status: 403, code: 'FORBIDDEN' }
    : { status: 401, code: 'UNAUTHORIZED' };

  assert.throws(
    () => guard(req, {}, next),
    (error) => {
      assert.equal(error.status, expected.status, message);
      assert.equal(error.code, expected.code, message);
      return true;
    },
    message
  );
  assert.equal(nextCalls, 0, message);
}

const guardTables = [
  { method: 'post', path: '/admin/facilities', cases: adminOnlyCases },
  { method: 'patch', path: '/admin/facilities/:id', cases: adminOnlyCases },
  { method: 'put', path: '/admin/facilities/:id/opening-hours', cases: adminOnlyCases },
  { method: 'get', path: '/facilities', cases: listCases }
];

for (const table of guardTables) {
  const label = `${table.method.toUpperCase()} ${table.path}`;

  test(`${label} role guard allows only the expected roles`, () => {
    const guard = roleGuardFor(table.method, table.path);

    for (const testCase of table.cases) {
      checkGuard(guard, label, testCase);
    }
  });
}

const validToken = 'a'.repeat(64);
const bearer = `Bearer ${validToken}`;
const facilityId = '55555555-5555-4555-8555-555555555555';

const adminUser = {
  userId: '11111111-1111-4111-8111-111111111111',
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

function byKind(responses) {
  return async (text) => responses[kindOf(text)] ?? { rows: [] };
}

function statementsOfKind(fake, kind) {
  return fake.statements.filter((statement) => kindOf(statement.text) === kind);
}

function facilityRow(overrides = {}) {
  return {
    id: facilityId,
    name: 'Pool',
    description: '',
    locationDescription: 'Block A',
    status: 'ACTIVE',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides
  };
}

const hours = [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '22:00' }];

function identityReply(user) {
  return async () => ({ ok: true, status: 200, json: async () => ({ data: user }) });
}

function useFakeFetch(t, initial) {
  const state = { reply: initial };
  const fetchMock = t.mock.method(globalThis, 'fetch', (...args) => state.reply(...args));
  return { fetchMock, setReply: (reply) => { state.reply = reply; } };
}

function silenceLogs(t) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
}

function send(baseUrl, method, path, { headers = {}, body } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
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
  assert.equal(JSON.stringify(response.body).includes('stack'), false, message);
}

function assertSuccessResponse(response, status, message) {
  assert.equal(response.status, status, message);
  assert.deepEqual(Object.keys(response.body).sort(), ['data', 'requestId'], message);
  assert.equal(response.body.requestId, response.headers['x-request-id'], message);
  assert.equal(response.headers['cache-control'], 'no-store', message);
}

function assertDatabaseUntouched(fake, message) {
  assert.equal(fake.connectCount, 0, message);
  assert.equal(fake.statements.length, 0, message);
}

const authTargets = [
  { method: 'GET', path: '/api/v1/facilities' },
  {
    method: 'POST',
    path: '/api/v1/admin/facilities',
    body: { name: 'Pool', locationDescription: 'Block A' }
  }
];

async function runAuthCases(t, cases, expected) {
  silenceLogs(t);
  const fake = useFakeDatabase();
  const fetchControl = useFakeFetch(t, identityReply(adminUser));

  await withServer(async (baseUrl) => {
    for (const target of authTargets) {
      for (const testCase of cases) {
        const message = `${target.method} ${target.path} - ${testCase.name}`;
        fetchControl.setReply(testCase.reply ?? identityReply(adminUser));
        const headers = testCase.authorization === undefined
          ? {}
          : { Authorization: testCase.authorization };

        const response = await send(baseUrl, target.method, target.path, {
          headers,
          body: target.body
        });

        assertErrorResponse(response, expected.status, expected.code, message);
      }
    }
  });

  assertDatabaseUntouched(fake, 'authentication failures');
  return fetchControl.fetchMock;
}

test('missing Authorization header returns 401 without calling identity', async (t) => {
  const fetchMock = await runAuthCases(
    t,
    [{ name: 'no header', authorization: undefined }],
    { status: 401, code: 'UNAUTHORIZED' }
  );

  assert.equal(fetchMock.mock.calls.length, 0);
});

test('malformed Authorization headers return 401 without calling identity', async (t) => {
  const fetchMock = await runAuthCases(
    t,
    [
      { name: 'Basic scheme', authorization: `Basic ${'a'.repeat(64)}` },
      { name: '63 character token', authorization: `Bearer ${'a'.repeat(63)}` },
      { name: 'non-hex token', authorization: `Bearer ${'z'.repeat(64)}` },
      { name: 'Bearer without token', authorization: 'Bearer' }
    ],
    { status: 401, code: 'UNAUTHORIZED' }
  );

  assert.equal(fetchMock.mock.calls.length, 0);
});

test('identity answering 401 returns 401 UNAUTHORIZED', async (t) => {
  const fetchMock = await runAuthCases(
    t,
    [
      {
        name: 'identity 401',
        authorization: bearer,
        reply: async () => ({ ok: false, status: 401, json: async () => ({}) })
      }
    ],
    { status: 401, code: 'UNAUTHORIZED' }
  );

  assert.equal(fetchMock.mock.calls.length, authTargets.length);
});

test('identity failures return 503 AUTH_UNAVAILABLE', async (t) => {
  const fetchMock = await runAuthCases(
    t,
    [
      {
        name: 'identity 500',
        authorization: bearer,
        reply: async () => ({ ok: false, status: 500, json: async () => ({}) })
      },
      {
        name: 'network error',
        authorization: bearer,
        reply: async () => {
          throw new TypeError('fetch failed');
        }
      },
      {
        name: 'unreadable JSON',
        authorization: bearer,
        reply: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          }
        })
      }
    ],
    { status: 503, code: 'AUTH_UNAVAILABLE' }
  );

  assert.equal(fetchMock.mock.calls.length, authTargets.length * 3);
});

test('invalid identity users return 503 AUTH_UNAVAILABLE', async (t) => {
  const fetchMock = await runAuthCases(
    t,
    [
      { name: 'data null', authorization: bearer, reply: identityReply(null) },
      {
        name: 'role MANAGER',
        authorization: bearer,
        reply: identityReply({ ...adminUser, role: 'MANAGER' })
      },
      {
        name: 'status INACTIVE',
        authorization: bearer,
        reply: identityReply({ ...residentUser, status: 'INACTIVE' })
      },
      {
        name: 'RESIDENT without unitId',
        authorization: bearer,
        reply: identityReply({ ...residentUser, unitId: null })
      },
      {
        name: 'userId not a string',
        authorization: bearer,
        reply: identityReply({ ...adminUser, userId: 42 })
      }
    ],
    { status: 503, code: 'AUTH_UNAVAILABLE' }
  );

  assert.equal(fetchMock.mock.calls.length, authTargets.length * 5);
});

test('the identity introspection request has the expected shape', async (t) => {
  silenceLogs(t);
  useFakeDatabase(byKind({ FACILITIES: { rows: [] } }));
  const { fetchMock } = useFakeFetch(t, identityReply(adminUser));

  await withServer(async (baseUrl) => {
    const response = await send(baseUrl, 'GET', '/api/v1/facilities', {
      headers: { Authorization: bearer }
    });
    assertSuccessResponse(response, 200, 'admin GET /facilities');
  });

  assert.equal(fetchMock.mock.calls.length, 1);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(String(url).endsWith('/internal/v1/auth/introspect'), true);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, bearer);
  assert.equal(options.headers['X-Service-Name'], 'bookings');
  assert.equal(options.headers['X-Service-Key'], process.env.AUTH_SERVICE_KEY);
  assert.equal(options.headers['X-Service-Key'].length, 64);
});

test('a resident session is refused on every admin route without touching the database', async (t) => {
  silenceLogs(t);
  const fake = useFakeDatabase();
  useFakeFetch(t, identityReply(residentUser));
  const requests = [
    {
      method: 'POST',
      path: '/api/v1/admin/facilities',
      body: { name: 'Pool', locationDescription: 'Block A' }
    },
    {
      method: 'PATCH',
      path: `/api/v1/admin/facilities/${facilityId}`,
      body: { name: 'New name' }
    },
    {
      method: 'PUT',
      path: `/api/v1/admin/facilities/${facilityId}/opening-hours`,
      body: { openingHours: hours }
    }
  ];

  await withServer(async (baseUrl) => {
    for (const request of requests) {
      const message = `resident ${request.method} ${request.path}`;
      const response = await send(baseUrl, request.method, request.path, {
        headers: { Authorization: bearer },
        body: request.body
      });
      assertErrorResponse(response, 403, 'FORBIDDEN', message);
    }
  });

  assertDatabaseUntouched(fake, 'resident on admin routes');
});

test('an admin session can create, edit, replace hours and list facilities', async (t) => {
  silenceLogs(t);
  const createdRow = facilityRow();
  const updatedRow = facilityRow({ name: 'New name' });
  const fake = useFakeDatabase(byKind({
    'INSERT FACILITY': { rows: [createdRow] },
    LOCK: { rows: [createdRow] },
    UPDATE: { rows: [updatedRow] },
    HOURS: { rows: hours },
    FACILITIES: { rows: [createdRow] }
  }));
  useFakeFetch(t, identityReply(adminUser));
  const headers = { Authorization: bearer };

  await withServer(async (baseUrl) => {
    const created = await send(baseUrl, 'POST', '/api/v1/admin/facilities', {
      headers,
      body: { name: 'Pool', locationDescription: 'Block A' }
    });
    assertSuccessResponse(created, 201, 'admin POST');
    assert.deepEqual(created.body.data, { ...createdRow, openingHours: [] });

    const edited = await send(baseUrl, 'PATCH', `/api/v1/admin/facilities/${facilityId}`, {
      headers,
      body: { name: 'New name' }
    });
    assertSuccessResponse(edited, 200, 'admin PATCH');
    assert.deepEqual(edited.body.data, { ...updatedRow, openingHours: hours });

    const replaced = await send(
      baseUrl,
      'PUT',
      `/api/v1/admin/facilities/${facilityId}/opening-hours`,
      { headers, body: { openingHours: hours } }
    );
    assertSuccessResponse(replaced, 200, 'admin PUT');
    assert.deepEqual(replaced.body.data, { ...createdRow, openingHours: hours });

    const listed = await send(baseUrl, 'GET', '/api/v1/facilities', { headers });
    assertSuccessResponse(listed, 200, 'admin GET');
    assert.deepEqual(listed.body.data, [{ ...createdRow, openingHours: hours }]);
  });

  assert.deepEqual(statementsOfKind(fake, 'INSERT FACILITY')[0].values, ['Pool', '', 'Block A']);
  assert.deepEqual(statementsOfKind(fake, 'UPDATE')[0].values, [facilityId, 'New name', null, null, null]);
  assert.deepEqual(statementsOfKind(fake, 'INSERT HOURS')[0].values, [facilityId, 1, '08:00', '22:00']);
});

test('residents list active facilities only and admins list all', async (t) => {
  silenceLogs(t);
  const fetchControl = useFakeFetch(t, identityReply(residentUser));

  await withServer(async (baseUrl) => {
    const residentFake = useFakeDatabase(byKind({ FACILITIES: { rows: [] } }));
    const residentResponse = await send(baseUrl, 'GET', '/api/v1/facilities', {
      headers: { Authorization: bearer }
    });
    assertSuccessResponse(residentResponse, 200, 'resident GET');
    assert.deepEqual(statementsOfKind(residentFake, 'FACILITIES')[0].values, [true]);

    fetchControl.setReply(identityReply(adminUser));
    const adminFake = useFakeDatabase(byKind({ FACILITIES: { rows: [] } }));
    const adminResponse = await send(baseUrl, 'GET', '/api/v1/facilities', {
      headers: { Authorization: bearer }
    });
    assertSuccessResponse(adminResponse, 200, 'admin GET');
    assert.deepEqual(statementsOfKind(adminFake, 'FACILITIES')[0].values, [false]);
  });
});

test('an unknown route with a valid token returns 404 without calling identity', async (t) => {
  silenceLogs(t);
  const fake = useFakeDatabase();
  const { fetchMock } = useFakeFetch(t, identityReply(adminUser));

  await withServer(async (baseUrl) => {
    const response = await send(baseUrl, 'GET', '/api/v1/admin/does-not-exist', {
      headers: { Authorization: bearer }
    });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'NOT_FOUND');
    assert.equal(response.body.requestId, response.headers['x-request-id']);
  });

  assert.equal(fetchMock.mock.calls.length, 0);
  assertDatabaseUntouched(fake, 'unknown route');
});

function identityStatusReply(status, ok, user) {
  return async () => ({ ok, status, json: async () => ({ data: user }) });
}

async function checkIdentityStatus(t, { status, ok, expected }) {
  silenceLogs(t);
  const fake = useFakeDatabase(byKind({ FACILITIES: { rows: [] } }));
  const { fetchMock } = useFakeFetch(t, identityStatusReply(status, ok, adminUser));
  const targets = expected.status === 200 ? authTargets.slice(0, 1) : authTargets;

  await withServer(async (baseUrl) => {
    for (const target of targets) {
      const message = `identity ${status} - ${target.method} ${target.path}`;
      const callsBefore = fetchMock.mock.calls.length;

      const response = await send(baseUrl, target.method, target.path, {
        headers: { Authorization: bearer },
        body: target.body
      });

      assert.equal(fetchMock.mock.calls.length - callsBefore, 1, message);

      if (expected.status === 200) {
        assertSuccessResponse(response, 200, message);
      } else {
        assertErrorResponse(response, expected.status, expected.code, message);
      }
    }
  });

  if (expected.status !== 200) {
    assertDatabaseUntouched(fake, `identity ${status}`);
  }
}

const identityStatusCases = [
  { status: 403, ok: false, expected: { status: 503, code: 'AUTH_UNAVAILABLE' } },
  { status: 404, ok: false, expected: { status: 503, code: 'AUTH_UNAVAILABLE' } },
  { status: 500, ok: false, expected: { status: 503, code: 'AUTH_UNAVAILABLE' } },
  { status: 502, ok: false, expected: { status: 503, code: 'AUTH_UNAVAILABLE' } },
  { status: 503, ok: false, expected: { status: 503, code: 'AUTH_UNAVAILABLE' } },
  { status: 401, ok: false, expected: { status: 401, code: 'UNAUTHORIZED' } }
];

for (const identityCase of identityStatusCases) {
  test(`identity ${identityCase.status} with a valid admin body is refused with ${identityCase.expected.status}`, async (t) => {
    await checkIdentityStatus(t, identityCase);
  });
}

test('identity 200 with a valid admin body still grants access', async (t) => {
  await checkIdentityStatus(t, { status: 200, ok: true, expected: { status: 200 } });
});
