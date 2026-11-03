import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 60000 },
} as never);
