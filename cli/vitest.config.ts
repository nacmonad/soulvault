import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    exclude: ['src/**/__integration__/**/*.test.ts', 'node_modules/**'],
    testTimeout: 120_000,
  },
});
