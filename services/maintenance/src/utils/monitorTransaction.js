export async function withMonitorTransaction(pool, work) {
  const client = await pool.connect();
  let broken = false;
  let begun = false;
  const onError = () => { broken = true; };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    begun = true;
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const result = await work(client);
    if (broken) throw new Error('Monitor connection interrupted.');
    await client.query('COMMIT');
    begun = false;
    return result;
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
    }
    if (/^(08|57P0)/.test(error.code || '') ||
        ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(error.code)) broken = true;
    throw error;
  } finally {
    client.off('error', onError);
    client.release(broken ? true : undefined);
  }
}
