import { defineConfig } from 'vitest/config';

/**
 * Vitest config for full-stack integration tests (Lane D of feat/agent-request-funds).
 *
 * - Requires a running local chain (ens-app-v3 on localhost:8545 by default).
 * - Runs `forge build` via globalSetup so Foundry artifacts are fresh.
 * - Isolates HOME to a temp dir so CLI state writes don't clobber the dev profile.
 * - Single-threaded because global setup mutates process.env.HOME.
 *
 * Run with: `pnpm test:integration`
 *
 * Default `pnpm test` uses the separate vitest.config.ts and does NOT pull in
 * these tests — unit tests stay fast and dependency-free.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__integration__/**/*.test.ts'],
    exclude: ['src/**/__integration__/**/*.testnet.test.ts'],
    testTimeout: 180_000,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    globalSetup: ['./test/global-setup.ts'],
  },
});
