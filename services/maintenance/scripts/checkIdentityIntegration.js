import assert from 'node:assert/strict';

if (process.env.DEMO_SEED_ENABLED !== 'true' ||
    process.env.NODE_ENV === 'production') {
  throw new Error('Run this script only in the local demo environment.');
}

const baseUrl = 'http://127.0.0.1:3001';

const serviceKeys = {
  bookings: process.env.BOOKINGS_AUTH_KEY,
  community: process.env.COMMUNITY_AUTH_KEY
};

for (const key of Object.values(serviceKeys)) {
  if (!/^[a-f0-9]{64}$/.test(key ?? '')) {
    throw new Error('Internal service keys are missing or invalid.');
  }
}

async function request(method, path, token, caller, body, overrideKey) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (caller) {
    headers['X-Service-Name'] = caller;
    headers['X-Service-Key'] = overrideKey ?? serviceKeys[caller];
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
    throw new Error(`Missing demo password for ${loginName}.`);
  }

  const response = await request(
    'POST', '/api/v1/auth/login', null, null,
    { login: loginName, password }
  );

  assert.equal(response.status, 200, `Login failed for ${loginName}.`);

  return (await response.json()).data;
}

async function check(name, response, expectedStatus) {
  const result = await response.json();

  assert.equal(
    response.status,
    expectedStatus,
    `${name}: expected ${expectedStatus}, received ${response.status}`
  );

  console.log(`PASS: ${name} (${expectedStatus})`);

  return result.data;
}

async function main() {
  const admin = await login('admin', process.env.DEMO_ADMIN_PASSWORD);
  const resident = await login('resident', process.env.DEMO_RESIDENT_PASSWORD);
  const resident2 = await login('resident2', process.env.DEMO_RESIDENT2_PASSWORD);

  const unitsPath = '/internal/v1/units/active';
  const recipientPath = '/internal/v1/users/notification-recipient';

  await check(
    'Service credentials are required',
    await request('GET', unitsPath, admin.accessToken, null),
    401
  );

  await check(
    'Invalid service key is rejected',
    await request(
      'GET', unitsPath, admin.accessToken, 'community',
      undefined, 'invalid-key'
    ),
    403
  );

  await check(
    'User authentication is required',
    await request('GET', unitsPath, null, 'community'),
    401
  );

  await check(
    'Bookings cannot use the community unit lookup',
    await request('GET', unitsPath, admin.accessToken, 'bookings'),
    403
  );

  await check(
    'Resident cannot list active units for invoice generation',
    await request('GET', unitsPath, resident.accessToken, 'community'),
    403
  );

  await check(
    'Community cannot use the booking recipient lookup',
    await request(
      'POST', recipientPath, admin.accessToken, 'community',
      { userId: resident.user.id }
    ),
    403
  );

  await check(
    'Resident cannot retrieve another recipient',
    await request(
      'POST', recipientPath, resident.accessToken, 'bookings',
      { userId: resident2.user.id }
    ),
    403
  );

  const ownRecipient = await check(
    'Resident can retrieve their own recipient details',
    await request(
      'POST', recipientPath, resident.accessToken, 'bookings',
      { userId: resident.user.id }
    ),
    200
  );

  assert.equal(ownRecipient.userId, resident.user.id);
  assert.equal(ownRecipient.email, resident.user.email);
  assert.deepEqual(
    Object.keys(ownRecipient).sort(),
    ['email', 'fullName', 'userId']
  );

  await check(
    'Admin can retrieve an eligible resident recipient',
    await request(
      'POST', recipientPath, admin.accessToken, 'bookings',
      { userId: resident.user.id }
    ),
    200
  );

  const missingRecipient = await request(
    'POST', recipientPath, admin.accessToken, 'bookings',
    { userId: admin.user.id }
  );

  const missingBody = await missingRecipient.json();
  assert.equal(missingRecipient.status, 404);
  assert.equal(missingBody.error.code, 'RECIPIENT_NOT_FOUND');
  console.log('PASS: admin account is not a resident recipient (404)');

  const invalidCursor = await request(
    'GET', `${unitsPath}?cursor=invalid`,
    admin.accessToken, 'community'
  );

  const cursorError = await invalidCursor.json();
  assert.equal(invalidCursor.status, 400);
  assert.equal(cursorError.error.code, 'INVALID_CURSOR');
  console.log('PASS: malformed cursor rejected (400)');

  const seenIds = new Set();
  const seenCursors = new Set();
  let cursor = null;
  let previousId = null;

  for (let pageNumber = 0; ; pageNumber++) {
    assert.ok(pageNumber < 1000, 'Pagination did not finish.');

    const suffix = cursor
      ? `&cursor=${encodeURIComponent(cursor)}`
      : '';

    const response = await request(
      'GET', `${unitsPath}?limit=1${suffix}`,
      admin.accessToken, 'community'
    );

    assert.equal(response.status, 200);

    const { data } = await response.json();

    assert.ok(Array.isArray(data.units));
    assert.ok(data.units.length <= 1);

    for (const unit of data.units) {
      assert.deepEqual(
        Object.keys(unit).sort(),
        ['buildingId', 'unitId', 'unitNumber']
      );

      assert.ok(!seenIds.has(unit.unitId), 'Duplicate unit across pages.');

      if (previousId !== null) {
        assert.ok(unit.unitId > previousId, 'Unit ordering changed.');
      }

      seenIds.add(unit.unitId);
      previousId = unit.unitId;
    }

    if (data.nextCursor === null) {
      break;
    }

    assert.equal(typeof data.nextCursor, 'string');
    assert.ok(data.units.length > 0);
    assert.ok(!seenCursors.has(data.nextCursor), 'Cursor repeated.');

    seenCursors.add(data.nextCursor);
    cursor = data.nextCursor;
  }

  console.log(`PASS: pagination completed without duplicates (${seenIds.size} units)`);
  console.log('Identity integration checks completed successfully.');
}

main().catch((error) => {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
});
