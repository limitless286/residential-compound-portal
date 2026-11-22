import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

if (!process.env.AWS_REGION || !process.env.SESSIONS_TABLE_NAME) {
  throw new Error('Missing DynamoDB configuration.');
}

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.DYNAMODB_ENDPOINT_URL || undefined,
  maxAttempts: 2
});

export const dynamoDb = DynamoDBDocumentClient.from(client);
export const sessionsTableName = process.env.SESSIONS_TABLE_NAME;
