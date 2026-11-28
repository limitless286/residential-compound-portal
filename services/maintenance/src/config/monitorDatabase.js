import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

let poolPromise;
export async function getMonitorDatabase() {
  if (!poolPromise) {
    poolPromise = createPool().catch(error => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

async function createPool() {
  let pool;
  try {
    const secretId = process.env.OVERDUE_DATABASE_SECRET_ID;
    const expected = process.env.MONITOR_EXPECTED_ENDPOINT;
    if (!secretId || !/^ep-[a-z0-9-]+$/.test(expected || '')) throw new Error();
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION,
      endpoint: process.env.SECRETS_MANAGER_ENDPOINT_URL || undefined,
      maxAttempts: 2
    });
    const response = await client.send(new GetSecretValueCommand({
      SecretId: secretId
    }), { abortSignal: AbortSignal.timeout(10000) });
    const secret = JSON.parse(response.SecretString);
    const url = new URL(secret.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        decodeURIComponent(url.username) !== 'maintenance_app' ||
        !url.password || url.pathname !== '/neondb' ||
        (!url.hostname.startsWith(expected + '-') && !url.hostname.startsWith(expected + '.'))) {
      throw new Error();
    }
    url.searchParams.set('sslmode', 'verify-full');
    pool = new pg.Pool({
      connectionString: url.toString(), enableChannelBinding: true,
      max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      statement_timeout: 8000
    });
    pool.on('error', () => console.error(JSON.stringify({
      timestamp: new Date().toISOString(), service: 'maintenance',
      action: 'MONITOR_DATABASE', outcome: 'CONNECTION_ERROR'
    })));
    const check = await pool.query(
      "SELECT current_setting('neon.endpoint_id', true) AS endpoint, " +
      "to_regclass('maintenance.overdue_notifications') AS notifications"
    );
    if (check.rows[0]?.endpoint !== expected || !check.rows[0]?.notifications) {
      throw new Error();
    }
    return pool;
  } catch {
    if (pool) await pool.end().catch(() => {});
    throw new Error('Monitor database unavailable or endpoint/schema check failed.');
  }
}
