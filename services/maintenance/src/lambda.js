import serverless from 'serverless-http';
import { loadRuntimeSecrets } from './config/loadRuntimeSecrets.js';

// Database and authentication modules read configuration when imported.
await loadRuntimeSecrets();

const { default: app } = await import('./app.js');
const handleRequest = serverless(app);

export async function handler(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  return handleRequest(event, context);
}
