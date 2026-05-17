import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts', 'apps/web/src/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  },
  resolve: {
    alias: {
      '@filamentbridge/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@filamentbridge/crypto': resolve(__dirname, 'packages/crypto/src/index.ts'),
      '@filamentbridge/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@filamentbridge/printer-connector': resolve(__dirname, 'packages/printer-connector/src/index.ts')
    }
  }
});
