import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Larder client (Vite + React 18). The dev server proxies /api to Fastify.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist/client',
    sourcemap: true,
  },
});
