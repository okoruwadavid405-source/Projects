import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT ?? '3001';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    // xfwd passes the browser's Host as X-Forwarded-Host so the API's same-origin check still works.
    proxy: { '/api': { target: `http://localhost:${apiPort}`, xfwd: true } },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
