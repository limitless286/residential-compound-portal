import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRuntimeSecrets
} from '../src/config/loadRuntimeSecrets.js';

function validSecret() {
  return {
    DATABASE_URL:
      'postgresql://maintenance_app:example-password@database.test/neondb',
    BOOKINGS_AUTH_KEY: 'a'.repeat(64),
    COMMUNITY_AUTH_KEY: 'b'.repeat(64)
  };
}

function environment() {
  return {
    MAINTENANCE_SECRET_ID: 'compound/maintenance/runtime',
    AWS_REGION: 'us-east-1'
  };
}

function fakeClient(values) {
  return {
    send: async () => ({ SecretString: JSON.stringify(values) })
  };
}

test('loads the intended secret and applies approved values', async () => {
  const env = environment();
  const values = validSecret();

  await loadRuntimeSecrets({
    env,
    client: {
      send: async (command, options) => {
        assert.equal(command.input.SecretId, env.MAINTENANCE_SECRET_ID);
        assert.ok(options.abortSignal);
        return { SecretString: JSON.stringify(values) };
      }
    }
  });

  assert.equal(env.DATABASE_URL, values.DATABASE_URL);
  assert.equal(env.BOOKINGS_AUTH_KEY, values.BOOKINGS_AUTH_KEY);
  assert.equal(env.COMMUNITY_AUTH_KEY, values.COMMUNITY_AUTH_KEY);
});

test('local mode does not call Secrets Manager', async () => {
  let called = false;
  const env = { DATABASE_URL: 'existing-local-value' };

  await loadRuntimeSecrets({
    env,
    client: {
      send: async () => {
        called = true;
        throw new Error('Must not be called.');
      }
    }
  });

  assert.equal(called, false);
  assert.equal(env.DATABASE_URL, 'existing-local-value');
});

test('access denied fails safely without revealing SDK details', async () => {
  const env = environment();

  await assert.rejects(
    loadRuntimeSecrets({
      env,
      client: {
        send: async () => {
          throw new Error('AccessDenied: private-debug-marker');
        }
      }
    }),
    error =>
      error.message === 'Maintenance runtime secrets could not be loaded.' &&
      !error.message.includes('private-debug-marker')
  );

  assert.equal(env.DATABASE_URL, undefined);
});

test('malformed secret JSON is rejected', async () => {
  await assert.rejects(loadRuntimeSecrets({
    env: environment(),
    client: {
      send: async () => ({ SecretString: '{invalid-json' })
    }
  }));
});

test('owner credentials are rejected', async () => {
  const values = validSecret();
  values.DATABASE_URL =
    'postgresql://neondb_owner:example-password@database.test/neondb';

  await assert.rejects(loadRuntimeSecrets({
    env: environment(),
    client: fakeClient(values)
  }));
});

test('invalid or reused service keys do not partially replace configuration', async () => {
  for (const badKey of ['invalid-key', 'a'.repeat(64)]) {
    const env = {
      ...environment(),
      DATABASE_URL: 'previous-database-value',
      BOOKINGS_AUTH_KEY: 'previous-bookings-value',
      COMMUNITY_AUTH_KEY: 'previous-community-value'
    };
    const before = { ...env };
    const values = validSecret();
    values.COMMUNITY_AUTH_KEY = badKey;

    await assert.rejects(loadRuntimeSecrets({
      env,
      client: fakeClient(values)
    }));

    assert.deepEqual(env, before);
  }
});

test('unexpected secret fields cannot override other runtime settings', async () => {
  const env = environment();
  const values = {
    ...validSecret(),
    NODE_ENV: 'untrusted',
    AWS_ACCESS_KEY_ID: 'untrusted'
  };

  await loadRuntimeSecrets({
    env,
    client: fakeClient(values)
  });

  assert.equal(env.NODE_ENV, undefined);
  assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
});
