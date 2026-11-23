import assert from 'node:assert/strict';

if (process.env.DEMO_SEED_ENABLED !== 'true' ||
    process.env.NODE_ENV === 'production') {
  throw new Error('Run this script only in the local demo environment.');
}

const baseUrl = 'http://127.0.0.1:3001/api/v1';
const requestId = process.env.TEST_CLOSED_REQUEST_ID;

if (!requestId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
  throw new Error('TEST_CLOSED_REQUEST_ID must be a valid UUID.');
}

async function send(method, path, token, body) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
}

async function login(loginName, password) {
  if (!password) {
    throw new Error(`Demo password is missing for ${loginName}.`);
  }

  const response = await send('POST', '/auth/login', null, {
    login: loginName,
    password
  });

  assert.equal(response.status, 200, `Login failed for ${loginName}.`);

  const result = await response.json();

  return result.data;
}

async function check(name, method, path, token, body, expected) {
  const response = await send(method, path, token, body);
  await response.text();

  assert.equal(
    response.status,
    expected,
    `${name}: expected ${expected}, received ${response.status}`
  );

  console.log(`PASS: ${name} (${expected})`);
}

async function main() {
  const admin = await login(
    'admin',
    process.env.DEMO_ADMIN_PASSWORD
  );

  const resident = await login(
    'resident',
    process.env.DEMO_RESIDENT_PASSWORD
  );

  const resident2 = await login(
    'resident2',
    process.env.DEMO_RESIDENT2_PASSWORD
  );

  const path = `/maintenance-requests/${requestId}`;

  // Verify the fixture before testing rejected mutations.
  const fixtureResponse = await send(
    'GET',
    path,
    resident.accessToken
  );

  assert.equal(fixtureResponse.status, 200);

  const fixture = (await fixtureResponse.json()).data.request;

  assert.equal(fixture.status, 'CLOSED', 'Fixture must be CLOSED.');
  assert.equal(fixture.userId, resident.user.id);
  assert.notEqual(fixture.userId, resident2.user.id);

  await check(
    'Overview requires authentication',
    'GET', '/admin/maintenance-overview',
    null, undefined, 401
  );

  await check(
    'Resident cannot view admin overview',
    'GET', '/admin/maintenance-overview',
    resident.accessToken, undefined, 403
  );

  await check(
    'Resident cannot start maintenance work',
    'PATCH', `${path}/start`,
    resident.accessToken, {}, 403
  );

  await check(
    'Resident cannot change priority',
    'PATCH', `${path}/priority`,
    resident.accessToken,
    { priority: 'HIGH', reason: 'Unauthorized priority change.' },
    403
  );

  await check(
    'Another resident cannot view the request',
    'GET', path,
    resident2.accessToken, undefined, 403
  );

  await check(
    'Another resident cannot confirm the request',
    'PATCH', `${path}/confirm`,
    resident2.accessToken, {}, 403
  );

  await check(
    'Another resident cannot reopen the request',
    'PATCH', `${path}/reopen`,
    resident2.accessToken,
    { reason: 'Unauthorized reopening attempt.' },
    403
  );

  await check(
    'Admin cannot start a closed request',
    'PATCH', `${path}/start`,
    admin.accessToken, {}, 409
  );

  await check(
    'Invalid request identifier is rejected',
    'GET', '/maintenance-requests/not-a-uuid',
    resident.accessToken, undefined, 400
  );

  await check(
    'Invalid status filter is rejected',
    'GET', '/maintenance-requests?status=INVALID',
    resident.accessToken, undefined, 400
  );

  // Check that rejected actions did not alter this request.
  const finalResponse = await send('GET', path, admin.accessToken);
  assert.equal(finalResponse.status, 200);

  const finalRequest = (await finalResponse.json()).data.request;

  assert.deepEqual(finalRequest, fixture);

  console.log('PASS: rejected actions left the request unchanged.');
  console.log('Completed: 10 rejection checks and final state verification.');
}

main().catch((error) => {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
});
