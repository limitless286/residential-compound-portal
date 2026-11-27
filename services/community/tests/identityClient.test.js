// Unit tests for the identity client with a MOCKED fetch. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllActiveUnits } from '../src/clients/identityClient.js';

const CONFIG = {
  baseUrl: 'http://identity.test',
  serviceName: 'community',
  serviceKey: 'a'.repeat(64),
  timeoutMs: 1000
};
const AUTH = 'Bearer ' + 'b'.repeat(64);
const UNIT_A = '11111111-1111-4111-8111-111111111111';
const UNIT_B = '22222222-2222-4222-8222-222222222222';
const UNIT_C = '33333333-3333-4333-8333-333333333333';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function pagedFetch(pages, calls = []) {
  return async (url, options) => {
    calls.push({ url: new URL(url), options });
    return pages.shift();
  };
}

test('collects every page before returning', async () => {
  const calls = [];
  const fetchImpl = pagedFetch([
    jsonResponse(200, { data: { units: [{ unitId: UNIT_A }, { unitId: UNIT_B }], nextCursor: 'page2' } }),
    jsonResponse(200, { data: { units: [{ unitId: UNIT_C }], nextCursor: null } })
  ], calls);

  const units = await fetchAllActiveUnits(
    { authorization: AUTH, requestId: 'req-1' },
    { fetchImpl, config: CONFIG }
  );

  assert.deepEqual(units.map((u) => u.unitId), [UNIT_A, UNIT_B, UNIT_C]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, '/internal/v1/units/active');
  assert.equal(calls[0].url.searchParams.get('limit'), '200');
  assert.equal(calls[0].url.searchParams.has('cursor'), false);
  assert.equal(calls[1].url.searchParams.get('cursor'), 'page2');
});

test('sends the documented service and user authentication headers', async () => {
  const calls = [];
  await fetchAllActiveUnits(
    { authorization: AUTH, requestId: 'req-1' },
    {
      fetchImpl: pagedFetch([
        jsonResponse(200, { data: { units: [], nextCursor: null } })
      ], calls),
      config: CONFIG
    }
  );

  const headers = calls[0].options.headers;
  assert.equal(headers.Authorization, AUTH);
  assert.equal(headers['X-Service-Name'], 'community');
  assert.equal(headers['X-Service-Key'], CONFIG.serviceKey);
});

test('removes duplicate units across pages', async () => {
  const units = await fetchAllActiveUnits(
    { authorization: AUTH },
    {
      fetchImpl: pagedFetch([
        jsonResponse(200, { data: { units: [{ unitId: UNIT_A }], nextCursor: 'p2' } }),
        jsonResponse(200, { data: { units: [{ unitId: UNIT_A.toUpperCase() }], nextCursor: null } })
      ]),
      config: CONFIG
    }
  );

  assert.equal(units.length, 1);
});

async function assertFails(responses, status, code) {
  await assert.rejects(
    fetchAllActiveUnits(
      { authorization: AUTH },
      { fetchImpl: pagedFetch(responses), config: CONFIG }
    ),
    (error) => error.status === status && error.code === code
  );
}

test('an expired session is reported as 401', () =>
  assertFails([jsonResponse(401, {})], 401, 'UNAUTHORIZED'));

test('identity errors fail closed with 503', () =>
  assertFails([jsonResponse(500, {})], 503, 'IDENTITY_UNAVAILABLE'));

test('a forbidden service credential fails closed with 503', () =>
  assertFails([jsonResponse(403, {})], 503, 'IDENTITY_UNAVAILABLE'));

test('a failure on a later page discards the earlier pages', () =>
  assertFails([
    jsonResponse(200, { data: { units: [{ unitId: UNIT_A }], nextCursor: 'p2' } }),
    jsonResponse(503, {})
  ], 503, 'IDENTITY_UNAVAILABLE'));

test('malformed unit data fails closed', () =>
  assertFails([
    jsonResponse(200, { data: { units: [{ unitId: 'not-a-uuid' }], nextCursor: null } })
  ], 503, 'IDENTITY_UNAVAILABLE'));

test('a repeated cursor is rejected instead of looping forever', () =>
  assertFails([
    jsonResponse(200, { data: { units: [], nextCursor: 'same' } }),
    jsonResponse(200, { data: { units: [], nextCursor: 'same' } })
  ], 503, 'IDENTITY_UNAVAILABLE'));

test('a network error fails closed with 503', async () => {
  await assert.rejects(
    fetchAllActiveUnits(
      { authorization: AUTH },
      {
        fetchImpl: async () => { throw new TypeError('fetch failed'); },
        config: CONFIG
      }
    ),
    (error) => error.status === 503
  );
});
