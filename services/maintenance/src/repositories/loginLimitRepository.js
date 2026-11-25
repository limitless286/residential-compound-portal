import { createHash } from 'node:crypto';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDb } from '../config/dynamoDb.js';

const windowMs = 15 * 60 * 1000;
const attemptLimit = 10;

export async function consumeLoginAttempt(clientIdentifier) {
  if (
    typeof clientIdentifier !== 'string' ||
    clientIdentifier.length === 0
  ) {
    throw new Error('A client identifier is required.');
  }

  const tableName = process.env.LOGIN_LIMITS_TABLE_NAME;

  if (!tableName) {
    throw Object.assign(new Error('Login protection is unavailable.'), {
      status: 503,
      code: 'LOGIN_PROTECTION_UNAVAILABLE'
    });
  }

  const now = Date.now();
  const windowNumber = Math.floor(now / windowMs);
  const resetAt = (windowNumber + 1) * windowMs;

  const fingerprint = createHash('sha256')
    .update(clientIdentifier)
    .digest('hex');

  const key = `login:${windowNumber}:${fingerprint}`;

  try {
    await dynamoDb.send(new UpdateCommand({
      TableName: tableName,
      Key: { key },
      UpdateExpression: 'SET #expiresAt = :expiresAt ADD #attempts :one',
      ConditionExpression:
        'attribute_not_exists(#attempts) OR #attempts < :limit',
      ExpressionAttributeNames: {
        '#expiresAt': 'expiresAt',
        '#attempts': 'attempts'
      },
      ExpressionAttributeValues: {
        ':expiresAt': Math.ceil(resetAt / 1000),
        ':one': 1,
        ':limit': attemptLimit
      }
    }));

    return { allowed: true, resetAt };
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return { allowed: false, resetAt };
    }

    throw Object.assign(new Error('Login protection is unavailable.'), {
      status: 503,
      code: 'LOGIN_PROTECTION_UNAVAILABLE'
    });
  }
}
