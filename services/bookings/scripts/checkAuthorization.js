import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';

import { requireAuthentication } from '../src/middleware/requireAuthentication.js';
import { requireRole } from '../src/middleware/requireRole.js';

const adminToken = process.env.TEST_ADMIN_TOKEN;
const residentToken = process.env.TEST_RESIDENT_TOKEN;

if (!adminToken || !residentToken) {
  throw new Error('Test tokens are missing.');
}

const app = express();

app.get(
  '/admin-only',
  requireAuthentication,
  requireRole('ADMIN'),
  (req, res) => res.status(204).end()
);

app.get(
  '/resident-only',
  requireAuthentication,
  requireRole('RESIDENT'),
  (req, res) => res.status(204).end()
);

app.use((error, req, res, next) => {
  res.status(error.status || 500).json({
    error: { code: error.code || 'INTERNAL_ERROR' }
  });
});

const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');

const baseUrl = 'http://127.0.0.1:' + server.address().port;
const identityUrl = process.env.IDENTITY_BASE_URL.replace(/\/+$/, '');
const introspectionUrl = identityUrl + '/internal/v1/auth/introspect';

async function check(name, expectedStatus, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000)
  });

  await response.arrayBuffer();
  assert.equal(response.status, expectedStatus, name);
  console.log('PASS: ' + name);
}

try {
  await check(
    'Missing user token returns 401',
    401,
    baseUrl + '/admin-only'
  );

  await check(
    'Invalid user token returns 401',
    401,
    baseUrl + '/admin-only',
    { headers: { Authorization: 'Bearer ' + '0'.repeat(64) } }
  );

  await check(
    'Resident cannot access admin action: 403',
    403,
    baseUrl + '/admin-only',
    { headers: { Authorization: 'Bearer ' + residentToken } }
  );

  await check(
    'Admin can access admin action',
    204,
    baseUrl + '/admin-only',
    { headers: { Authorization: 'Bearer ' + adminToken } }
  );

  await check(
    'Resident can access resident action',
    204,
    baseUrl + '/resident-only',
    { headers: { Authorization: 'Bearer ' + residentToken } }
  );

  await check(
    'Admin is rejected from a resident-only action',
    403,
    baseUrl + '/resident-only',
    { headers: { Authorization: 'Bearer ' + adminToken } }
  );

  await check(
    'Introspection without service credentials returns 401',
    401,
    introspectionUrl,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + adminToken }
    }
  );

  await check(
    'Introspection with wrong service key returns 403',
    403,
    introspectionUrl,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + adminToken,
        'X-Service-Name': process.env.SERVICE_NAME,
        'X-Service-Key': 'invalid'
      }
    }
  );

  console.log('All 8 checks passed for ' + process.env.SERVICE_NAME + '.');
} catch (error) {
  console.error('Authorization checks failed:', error.message);
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
