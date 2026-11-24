import { httpError } from '../utils/httpError.js';
import { isUuid } from '../utils/validation.js';

const PAGE_LIMIT = 200;
const MAX_PAGES = 100;

function readConfig() {
  return {
    baseUrl: (process.env.IDENTITY_BASE_URL || '').replace(/\/+$/, ''),
    serviceName: process.env.SERVICE_NAME,
    serviceKey: process.env.AUTH_SERVICE_KEY,
    timeoutMs: Number(process.env.IDENTITY_TIMEOUT_MS || 10000)
  };
}

function unavailable() {
  return httpError(
    503,
    'IDENTITY_UNAVAILABLE',
    'The identity service is temporarily unavailable.'
  );
}

// Fetches every page of GET /internal/v1/units/active before returning.
// Any failure aborts the whole lookup, so callers never act on a
// partial unit list.
export async function fetchAllActiveUnits(
  { authorization, requestId },
  { fetchImpl = fetch, config = readConfig() } = {}
) {
  if (!config.baseUrl || !config.serviceName || !config.serviceKey) {
    throw unavailable();
  }

  const units = [];
  const seen = new Set();
  let cursor = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(config.baseUrl + '/internal/v1/units/active');
    url.searchParams.set('limit', String(PAGE_LIMIT));

    if (cursor !== null) {
      url.searchParams.set('cursor', cursor);
    }

    let response;

    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          'X-Service-Name': config.serviceName,
          'X-Service-Key': config.serviceKey,
          'X-Request-Id': requestId
        },
        signal: AbortSignal.timeout(config.timeoutMs)
      });
    } catch {
      throw unavailable();
    }

    if (response.status === 401) {
      throw httpError(401, 'UNAUTHORIZED', 'A valid session is required.');
    }

    if (!response.ok) {
      throw unavailable();
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      throw unavailable();
    }

    const data = payload?.data;

    if (!data || !Array.isArray(data.units) ||
        !(data.nextCursor === null || typeof data.nextCursor === 'string')) {
      throw unavailable();
    }

    for (const unit of data.units) {
      if (!unit || !isUuid(unit.unitId)) {
        throw unavailable();
      }

      const unitId = unit.unitId.toLowerCase();

      if (!seen.has(unitId)) {
        seen.add(unitId);
        units.push({ unitId });
      }
    }

    if (data.nextCursor === null) {
      return units;
    }

    if (data.nextCursor === cursor) {
      throw unavailable();
    }

    cursor = data.nextCursor;
  }

  throw unavailable();
}
