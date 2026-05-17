import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('apps/server/dist', { recursive: true, force: true });

await build({
  entryPoints: ['apps/server/src/index.ts'],
  outfile: 'apps/server/dist/index.cjs',
  bundle: true,
  platform: 'node',
  target: ['node24'],
  format: 'cjs',
  sourcemap: true,
  packages: 'external',
  external: ['node:*'],
  logLevel: 'info'
});
