import { defineConfig } from 'vitest/config';

/**
 * Vitest config for full-stack integration tests (Lane D of feat/agent-request-funds).
 *
 * - Requires a running local chain (ens-app-v3 on localhost:8545 by default).
 * - Runs `forge build` via globalSetup so Foundry artifacts are fresh.
 * - Isolates HOME to a temp dir so CLI state writes don't clobber the dev profile.
 * - Serialized because global setup mutates process.env.HOME and every test file
 *   drives the SAME signer EOA against the SAME chain. Two files registering ENS
 *   concurrently race on that wallet's nonce: one transaction replaces the other, the
 *   replaced one never gets a receipt, and its tx.wait() blocks until the suite dies.
 *   Use `fileParallelism`, NOT `poolOptions` — Vitest 4 removed poolOptions and ignores
 *   it silently, which is exactly how this regressed.
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
    exclude: [
      'src/**/__integration__/**/*.testnet.test.ts',
      'src/**/__integration__/**/*.ledger.integration.test.ts',
      'src/**/__integration__/**/*.speculos.integration.test.ts',
    ],
    testTimeout: 180_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    globalSetup: ['./test/global-setup.ts'],
  },
});
