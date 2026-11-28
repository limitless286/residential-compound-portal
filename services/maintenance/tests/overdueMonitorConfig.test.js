import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERDUE_MONITOR_PARAMETER,
  validateMonitorConfig,
  readMonitorConfig
} from '../src/config/overdueMonitorConfig.js';

const valid = {
  enabled: false,
  batchSize: 50,
  repeatAfterHours: 24
};

test('valid disabled configuration is preserved', () => {
  assert.deepEqual(validateMonitorConfig(valid), valid);
});

test('invalid settings are rejected', () => {
  for (const changes of [
    { enabled: 'false' },
    { batchSize: 0 },
    { batchSize: 101 },
    { batchSize: 1.5 },
    { repeatAfterHours: 0 },
    { repeatAfterHours: 169 },
    { repeatAfterHours: 1.5 },
    { unexpected: true }
  ]) {
    assert.throws(() => validateMonitorConfig({
      ...valid,
      ...changes
    }));
  }

  assert.throws(() => validateMonitorConfig({}));
  assert.throws(() => validateMonitorConfig(null));
});

test('reads the intended SSM parameter', async () => {
  const config = await readMonitorConfig({
    client: {
      send: async (command, options) => {
        assert.equal(command.input.Name, OVERDUE_MONITOR_PARAMETER);
        assert.equal(command.input.WithDecryption, false);
        assert.ok(options.abortSignal);

        return {
          Parameter: {
            Type: 'String',
            Value: JSON.stringify(valid)
          }
        };
      }
    }
  });

  assert.deepEqual(config, valid);
});

test('SSM failure stops monitoring with a safe error', async () => {
  await assert.rejects(
    readMonitorConfig({
      client: {
        send: async () => { throw new Error('private-debug-details'); }
      }
    }),
    error => error.status === 503 &&
      error.code === 'MONITOR_CONFIG_UNAVAILABLE' &&
      !error.message.includes('private-debug-details')
  );
});

test('malformed or unexpected parameter contents are rejected', async () => {
  for (const parameter of [
    { Type: 'String', Value: '{invalid' },
    { Type: 'String', Value: '{}' },
    { Type: 'SecureString', Value: JSON.stringify(valid) }
  ]) {
    await assert.rejects(
      readMonitorConfig({
        client: {
          send: async () => ({ Parameter: parameter })
        }
      }),
      error => error.status === 503
    );
  }
});
