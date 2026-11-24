// HTTP tests against the real Express app with a MOCKED identity service.
// A local fake identity server stands in for maintenance; no database,
// no Neon and no real sessions are used.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const TOKEN = 'b'.repeat(64);
let identityResponse = { status: 200, body: {} };
let identityServer;
let appServer;
let baseUrl;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

before(async () => {
  identityServer = createServer((req, res) => {
    res.writeHead(identityResponse.status, {
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify(identityResponse.body));
  });
  const identityPort = await listen(identityServer);

  process.env.SERVICE_NAME = 'community';
  process.env.AUTH_SERVICE_KEY = 'a'.repeat(64);
  process.env.IDENTITY_BASE_URL = 'http://127.0.0.1:' + identityPort;

  const { default: app } = await import('../src/app.js');
  appServer = createServer(app);
  baseUrl = 'http://127.0.0.1:' + await listen(appServer);
});

after(() => {
  appServer?.close();
  identityServer?.close();
});

async function call(path, headers = {}, { method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: body === undefined
      ? headers
      : { ...headers, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function identityReturns(role) {
  identityResponse = {
    status: 200,
    body: {
      data: {
        userId: '33333333-3333-4333-8333-333333333333',
        email: 'user@example.com',
        fullName: 'Demo User',
        role,
        unitId: role === 'RESIDENT'
          ? '11111111-1111-4111-8111-111111111111'
          : null,
        buildingId: null,
        status: 'ACTIVE'
      }
    }
  };
}

const AUTH_HEADER = { Authorization: 'Bearer ' + 'b'.repeat(64) };

test('health endpoint returns the success envelope', async () => {
  const { status, body } = await call('/api/v1/health');
  assert.equal(status, 200);
  assert.equal(body.data.service, 'community');
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
});

test('unknown endpoint returns 404 with the error envelope', async () => {
  const { status, body } = await call('/api/v1/nothing-here');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('missing bearer token returns 401 without calling identity', async () => {
  const { status, body } = await call('/api/v1/auth/me');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('session rejected by identity returns 401', async () => {
  identityResponse = { status: 401, body: {} };
  const { status } = await call('/api/v1/auth/me', {
    Authorization: 'Bearer ' + TOKEN
  });
  assert.equal(status, 401);
});

test('identity failure fails closed with 503', async () => {
  identityResponse = { status: 500, body: {} };
  const { status, body } = await call('/api/v1/auth/me', {
    Authorization: 'Bearer ' + TOKEN
  });
  assert.equal(status, 503);
  assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
});

test('valid session returns the authenticated user', async () => {
  identityResponse = {
    status: 200,
    body: {
      data: {
        userId: '33333333-3333-4333-8333-333333333333',
        email: 'resident@example.com',
        fullName: 'Demo Resident',
        role: 'RESIDENT',
        unitId: '11111111-1111-4111-8111-111111111111',
        buildingId: '22222222-2222-4222-8222-222222222222',
        status: 'ACTIVE'
      }
    }
  };
  const { status, body } = await call('/api/v1/auth/me', {
    Authorization: 'Bearer ' + TOKEN
  });
  assert.equal(status, 200);
  assert.equal(body.data.role, 'RESIDENT');
  assert.equal(body.data.unitId, '11111111-1111-4111-8111-111111111111');
});

test('residents cannot reach admin fee endpoints', async () => {
  identityReturns('RESIDENT');

  for (const [method, path, body] of [
    ['GET', '/api/v1/admin/fee-policy'],
    ['PUT', '/api/v1/admin/fee-policy', { monthlyAmountMinor: 1, dueDay: 1 }],
    ['POST', '/api/v1/admin/invoice-generations', { billingPeriod: '2026-12' }],
    ['POST', '/api/v1/admin/payments', { invoiceId: '44444444-4444-4444-8444-444444444444' }],
    ['GET', '/api/v1/admin/overdue-invoices']
  ]) {
    const { status, body: response } = await call(path, AUTH_HEADER, { method, body });
    assert.equal(status, 403, method + ' ' + path);
    assert.equal(response.error.code, 'FORBIDDEN');
  }
});

test('admin endpoints require authentication', async () => {
  const { status } = await call('/api/v1/admin/fee-policy');
  assert.equal(status, 401);
});

test('invoice generation requires an Idempotency-Key', async () => {
  identityReturns('ADMIN');
  const { status, body } = await call(
    '/api/v1/admin/invoice-generations',
    AUTH_HEADER,
    { method: 'POST', body: { billingPeriod: '2026-12' } }
  );
  assert.equal(status, 400);
  assert.equal(body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('a resident cannot choose another unit when listing invoices', async () => {
  identityReturns('RESIDENT');
  const { status } = await call(
    '/api/v1/invoices?unitId=22222222-2222-4222-8222-222222222222',
    AUTH_HEADER
  );
  assert.equal(status, 400);
});
