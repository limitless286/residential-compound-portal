import serverless from 'serverless-http';
import app from './app.js';

const handleRequest = serverless(app);

export async function handler(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  return handleRequest(event, context);
}
