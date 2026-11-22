import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing.');
}

const connectionUrl = new URL(process.env.DATABASE_URL);
connectionUrl.searchParams.set('sslmode', 'verify-full');

const client = new pg.Client({
  connectionString: connectionUrl.toString(),
  enableChannelBinding: true,
  connectionTimeoutMillis: 15000
});

try {
  await client.connect();

  const result = await client.query(`
    SELECT
      current_user AS "databaseUser",
      current_database() AS "databaseName",
      has_schema_privilege(current_user, 'identity', 'USAGE')
        AS "identityAccess",
      has_schema_privilege(current_user, 'maintenance', 'USAGE')
        AS "maintenanceAccess",
      has_schema_privilege(current_user, 'bookings', 'USAGE')
        AS "bookingsAccess",
      has_schema_privilege(current_user, 'community', 'USAGE')
        AS "communityAccess"
  `);

  console.table(result.rows);
} catch (error) {
  console.error('Database check failed. Code:', error.code || 'UNKNOWN');
  process.exitCode = 1;
} finally {
  await client.end();
}
