import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/maintenance-api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/maintenance-api/, '/api/v1')
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
});
