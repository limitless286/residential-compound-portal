import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontendRoot, '');

  const maintenanceTarget =
    env.MAINTENANCE_PROXY_TARGET || 'http://127.0.0.1:3001';

  const maintenancePrefix =
    env.MAINTENANCE_PROXY_PREFIX || '/api/v1';

  return {
    root: frontendRoot,
    envDir: frontendRoot,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/maintenance-api': {
          target: maintenanceTarget,
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/maintenance-api/, maintenancePrefix)
        },
        '/bookings-api': {
          target: 'http://127.0.0.1:3002',
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/bookings-api/, '/api/v1')
        },
        '/community-api': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/community-api/, '/api/v1')
        }
      }
    }
  };
});
