import {
  SecretsManagerClient,
  GetSecretValueCommand
} from '@aws-sdk/client-secrets-manager';

export async function loadRuntimeSecrets({
  env = process.env,
  client
} = {}) {
  // Local Express development can continue using its private .env.
  if (!env.MAINTENANCE_SECRET_ID) {
    return;
  }

  const secretClient = client || new SecretsManagerClient({
    region: env.AWS_REGION,
    endpoint: env.SECRETS_MANAGER_ENDPOINT_URL || undefined,
    maxAttempts: 2
  });

  let values;

  try {
    const result = await secretClient.send(
      new GetSecretValueCommand({
        SecretId: env.MAINTENANCE_SECRET_ID
      }),
      { abortSignal: AbortSignal.timeout(10000) }
    );

    values = JSON.parse(result.SecretString);

    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error('Invalid secret.');
    }

    const databaseUrl = new URL(values.DATABASE_URL);

    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
        decodeURIComponent(databaseUrl.username) !== 'maintenance_app' ||
        !databaseUrl.password) {
      throw new Error('Invalid database configuration.');
    }

    for (const name of ['BOOKINGS_AUTH_KEY', 'COMMUNITY_AUTH_KEY']) {
      if (typeof values[name] !== 'string' ||
          !/^[a-f0-9]{64}$/.test(values[name])) {
        throw new Error('Invalid identity configuration.');
      }
    }

    if (values.BOOKINGS_AUTH_KEY === values.COMMUNITY_AUTH_KEY) {
      throw new Error('Identity keys must differ.');
    }
  } catch {
    // Fail initialization without printing secret contents or SDK errors.
    throw new Error('Maintenance runtime secrets could not be loaded.');
  }

  // Apply only the approved values after validating the whole secret.
  for (const name of [
    'DATABASE_URL',
    'BOOKINGS_AUTH_KEY',
    'COMMUNITY_AUTH_KEY'
  ]) {
    env[name] = values[name];
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'maintenance',
    action: 'RUNTIME_SECRET_LOAD',
    outcome: 'SUCCESS'
  }));
}
