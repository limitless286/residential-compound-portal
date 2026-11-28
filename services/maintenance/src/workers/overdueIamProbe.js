// Used only by the operator's temporary IAM probe Lambdas, never by an API.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
export async function handler() {
  const role = process.env.MONITOR_PROBE_ROLE;
  if (!['scanner', 'consumer'].includes(role) || !process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID === 'test') {
    throw new Error('Execution-role credentials are required.');
  }
  const config = endpoint => ({ region: process.env.AWS_REGION, endpoint, maxAttempts: 1 });
  const secrets = new SecretsManagerClient(config(process.env.SECRETS_MANAGER_ENDPOINT_URL));
  const ssm = new SSMClient(config(process.env.SSM_ENDPOINT_URL));
  const sqs = new SQSClient(config(process.env.SQS_ENDPOINT_URL));
  const dynamo = new DynamoDBClient(config(process.env.SQS_ENDPOINT_URL));
  const checks = [];
  async function check(name, expectedDenied, client, command) {
    try {
      await client.send(command, { abortSignal: AbortSignal.timeout(5000) });
      checks.push({ name, passed: !expectedDenied });
    } catch (error) {
      checks.push({ name, passed: expectedDenied && ['AccessDeniedException', 'AccessDenied'].includes(error.name), errorType: error.name });
    }
  }
  await check('own database secret readable', false, secrets, new GetSecretValueCommand({ SecretId: process.env.OVERDUE_DATABASE_SECRET_ID }));
  await check('identity secret denied', true, secrets, new GetSecretValueCommand({ SecretId: 'compound/maintenance/runtime' }));
  await check(role === 'scanner' ? 'scanner parameter readable' : 'consumer parameter denied', role !== 'scanner', ssm, new GetParameterCommand({ Name: '/compound/maintenance/overdue-monitor' }));
  await check(role === 'consumer' ? 'consumer queue attributes readable' : 'scanner queue inspection denied', role !== 'consumer', sqs, new GetQueueAttributesCommand({ QueueUrl: process.env.OVERDUE_QUEUE_URL, AttributeNames: ['QueueArn'] }));
  await check('session table denied', true, dynamo, new ScanCommand({ TableName: 'compound-sessions', Limit: 1, Select: 'COUNT' }));
  return { role, checks, passed: checks.every(item => item.passed) };
}
