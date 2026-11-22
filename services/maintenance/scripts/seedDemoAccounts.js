import { database } from '../src/config/database.js';
import {
  hashPassword,
  verifyPassword
} from '../src/services/passwordService.js';

let client;
let transactionStarted = false;

function setupError(code) {
  return Object.assign(new Error(code), { code });
}

try {
  if (
    process.env.DEMO_SEED_ENABLED !== 'true' ||
    process.env.NODE_ENV === 'production'
  ) {
    throw setupError('DEMO_SEED_NOT_ALLOWED');
  }

  const accounts = [
    {
      email: 'admin@example.com',
      name: 'Demo Admin',
      role: 'ADMIN',
      unitNumber: null,
      password: process.env.DEMO_ADMIN_PASSWORD
    },
    {
      email: 'resident@example.com',
      name: 'Demo Resident One',
      role: 'RESIDENT',
      unitNumber: '101',
      password: process.env.DEMO_RESIDENT_PASSWORD
    },
    {
      email: 'resident2@example.com',
      name: 'Demo Resident Two',
      role: 'RESIDENT',
      unitNumber: '102',
      password: process.env.DEMO_RESIDENT2_PASSWORD
    }
  ];

  for (const account of accounts) {
    if (!account.password) {
      throw setupError('DEMO_PASSWORD_MISSING');
    }

    account.passwordHash = await hashPassword(
      account.password,
      { demoOnly: true }
    );
  }

  client = await database.connect();
  await client.query('BEGIN');
  transactionStarted = true;

  await client.query(`
    INSERT INTO identity.buildings (code, name)
    VALUES ('DEMO-A', 'Demo Building A')
    ON CONFLICT (code) DO NOTHING
  `);

  const building = await client.query(`
    SELECT id FROM identity.buildings WHERE code = 'DEMO-A'
  `);
  const buildingId = building.rows[0].id;
  const unitIds = {};

  for (const number of ['101', '102']) {
    await client.query(`
      INSERT INTO identity.units (building_id, unit_number)
      VALUES ($1, $2)
      ON CONFLICT (building_id, unit_number) DO NOTHING
    `, [buildingId, number]);

    const unit = await client.query(`
      SELECT id FROM identity.units
      WHERE building_id = $1 AND unit_number = $2
    `, [buildingId, number]);

    unitIds[number] = unit.rows[0].id;
  }

  for (const account of accounts) {
    const unitId = account.unitNumber
      ? unitIds[account.unitNumber]
      : null;

    const existing = await client.query(`
      SELECT role, unit_id, password_hash, status
      FROM identity.users WHERE email = $1
    `, [account.email]);

    if (existing.rowCount > 0) {
      const user = existing.rows[0];
      const matches =
        user.role === account.role &&
        user.unit_id === unitId &&
        user.status === 'ACTIVE' &&
        await verifyPassword(account.password, user.password_hash);

      if (!matches) {
        throw setupError('DEMO_ACCOUNT_CONFLICT');
      }

      continue;
    }

    await client.query(`
      INSERT INTO identity.users (
        full_name, email, password_hash, role, unit_id
      )
      VALUES ($1, $2, $3, $4, $5)
    `, [
      account.name,
      account.email,
      account.passwordHash,
      account.role,
      unitId
    ]);
  }

  await client.query('COMMIT');
  transactionStarted = false;

  console.log('Demo building, units, and accounts are ready.');
  console.table(accounts.map(({ email, role }) => ({ email, role })));
} catch (error) {
  if (client && transactionStarted) {
    try {
      await client.query('ROLLBACK');
    } catch {
      console.error('Rollback failed.');
    }
  }

  console.error('Demo setup failed:', error.code || error.name);
  process.exitCode = 1;
} finally {
  client?.release();
  await database.end();
}
