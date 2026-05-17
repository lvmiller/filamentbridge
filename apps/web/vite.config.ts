import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000'
    }
  },
  resolve: {
    alias: {
      '@filamentbridge/shared': resolve(__dirname, '../../packages/shared/src/index.ts')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
