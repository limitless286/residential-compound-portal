import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing.');
}

const connectionUrl = new URL(process.env.DATABASE_URL);
connectionUrl.searchParams.set('sslmode', 'verify-full');

export const database = new pg.Pool({
  connectionString: connectionUrl.toString(),
  enableChannelBinding: true,
  max: 5,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000
});

database.on('error', (error) => {
  console.error('Database pool error:', error.code || 'UNKNOWN');
});
