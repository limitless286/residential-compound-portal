import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';

const { database, withTransaction } = await import('../src/config/database.js');

function useFakeClient({ rollbackError } = {}) {
  const fake = { queries: [], releaseCount: 0 };

  const client = {
    async query(text, values) {
      fake.queries.push(values === undefined ? { text } : { text, values });
      if (text === 'ROLLBACK' && rollbackError) {
        throw rollbackError;
      }
      return { rows: [] };
    },
    release() {
      fake.releaseCount += 1;
    }
  };

  database.connect = async () => client;
  return fake;
}

function queryTexts(fake) {
  return fake.queries.map((query) => query.text);
}

function failWithCode(code) {
  return async () => {
    throw Object.assign(new Error(`database error ${code}`), { code });
  };
}

test.after(async () => {
  await database.end();
});

test('success runs BEGIN, set_config and COMMIT, then releases once', async () => {
  const fake = useFakeClient();

  const result = await withTransaction(async () => 'done');

  assert.equal(result, 'done');
  assert.deepEqual(fake.queries, [
    { text: 'BEGIN' },
    { text: "SELECT set_config('lock_timeout', $1, true)", values: ['5000ms'] },
    { text: 'COMMIT' }
  ]);
  assert.equal(fake.releaseCount, 1);
});

test('a thrown error rolls back and is rethrown unchanged', async () => {
  const fake = useFakeClient();
  const original = new Error('work failed');

  await assert.rejects(
    withTransaction(async () => {
      throw original;
    }),
    (error) => {
      assert.equal(error, original);
      return true;
    }
  );

  assert.deepEqual(queryTexts(fake), [
    'BEGIN',
    "SELECT set_config('lock_timeout', $1, true)",
    'ROLLBACK'
  ]);
  assert.equal(fake.releaseCount, 1);
});

test('lock timeout 55P03 becomes 503 SERVICE_BUSY after ROLLBACK', async () => {
  const fake = useFakeClient();

  await assert.rejects(withTransaction(failWithCode('55P03')), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, 'SERVICE_BUSY');
    assert.equal(error.message, 'The service is busy. Please try again.');
    return true;
  });

  assert.equal(queryTexts(fake).at(-1), 'ROLLBACK');
  assert.equal(fake.releaseCount, 1);
});

test('deadlock 40P01 becomes 503 SERVICE_BUSY', async () => {
  const fake = useFakeClient();

  await assert.rejects(withTransaction(failWithCode('40P01')), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, 'SERVICE_BUSY');
    return true;
  });

  assert.equal(queryTexts(fake).at(-1), 'ROLLBACK');
  assert.equal(fake.releaseCount, 1);
});

test('a failing ROLLBACK does not hide the original error', async () => {
  const fake = useFakeClient({ rollbackError: new Error('rollback failed') });
  const original = new Error('work failed');

  await assert.rejects(
    withTransaction(async () => {
      throw original;
    }),
    (error) => {
      assert.equal(error, original);
      return true;
    }
  );

  assert.equal(queryTexts(fake).at(-1), 'ROLLBACK');
  assert.equal(fake.releaseCount, 1);
});
