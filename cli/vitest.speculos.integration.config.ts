import { defineConfig } from 'vitest/config';

/**
 * Vitest config for Speculos-driven integration tests.
 *
 * Includes only `*.speculos.integration.test.ts` under src/lib/__integration__/.
 * Requires: Docker, Ledger app ELF under cli/test/speculos/apps/, local
 * ens-app-v3 RPC on 127.0.0.1:8545. See docs/clear-signing-runbook.md.
 *
 * Run with: `pnpm test:speculos`
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__integration__/**/*.speculos.integration.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    poolOptions: {
      threads: { singleThread: true },
    },
    fileParallelism: false,
    sequence: { concurrent: false },
    globalSetup: ['./test/global-setup-speculos.ts'],
  },
});
