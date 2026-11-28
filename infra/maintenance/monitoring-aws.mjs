import { execFileSync } from 'node:child_process';
export const profile = process.env.FLOCI_DEPLOY_PROFILE || 'floci';
export const endpoint = (process.env.FLOCI_DEPLOY_ENDPOINT || 'http://127.0.0.1:4566').replace(/\/+$/, '');
if (!['127.0.0.1', 'localhost'].includes(new URL(endpoint).hostname)) {
  throw new Error('Monitoring deployment requires a loopback Floci endpoint.');
}
export function aws(args, allowMissing = false) {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws', [
      ...args, '--profile', profile, '--endpoint-url', endpoint,
      '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return output.trim() ? JSON.parse(output) : null;
  } catch (error) {
    const stderr = String(error.stderr || '');
    if (allowMissing && /ResourceNotFoundException|NotFoundException|does not exist/.test(stderr)) return null;
    // Never include command payloads, SDK errors or configuration in output.
    throw new Error('Floci command failed: ' + args[0] + ' ' + args[1]);
  }
}
