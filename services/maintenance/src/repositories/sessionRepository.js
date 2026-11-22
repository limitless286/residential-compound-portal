import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

import {
  dynamoDb,
  sessionsTableName
} from '../config/dynamoDb.js';

export async function saveSession(session) {
  await dynamoDb.send(new PutCommand({
    TableName: sessionsTableName,
    Item: {
      tokenHash: session.tokenHash,
      userId: session.userId,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt
    },
    ConditionExpression: 'attribute_not_exists(tokenHash)'
  }));
}

export async function findSession(tokenHash) {
  const result = await dynamoDb.send(new GetCommand({
    TableName: sessionsTableName,
    Key: { tokenHash },
    ConsistentRead: true
  }));

  return result.Item || null;
}

export async function deleteSession(tokenHash) {
  await dynamoDb.send(new DeleteCommand({
    TableName: sessionsTableName,
    Key: { tokenHash }
  }));
}

export async function refreshActiveSession(tokenHash, now, idleCutoff) {
  try {
    const result = await dynamoDb.send(new UpdateCommand({
      TableName: sessionsTableName,
      Key: { tokenHash },
      UpdateExpression: 'SET lastSeenAt = :now',
      ConditionExpression:
        'attribute_exists(tokenHash) AND expiresAt > :now AND lastSeenAt > :cutoff',
      ExpressionAttributeValues: {
        ':now': now,
        ':cutoff': idleCutoff
      },
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return null;
    }

    throw error;
  }
}
