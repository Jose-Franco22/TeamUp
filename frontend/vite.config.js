import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the Express backend in development so the
    // frontend can call /api/... without CORS configuration.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // Unit and component tests (npm test). jsdom stands in for the browser;
  // tests run against the mock API unless a test stubs VITE_USE_MOCKS itself.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    env: { VITE_USE_MOCKS: 'true' },
    restoreMocks: true,
    unstubEnvs: true,
  },
});
