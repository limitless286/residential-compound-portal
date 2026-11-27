import serverless from 'serverless-http';
import app from './app.js';

const handleRequest = serverless(app);

// The response is returned before the handler resolves. Nothing is left
// running after it: the database pool is reused by the next invocation.
export async function handler(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  return handleRequest(event, context);
}
