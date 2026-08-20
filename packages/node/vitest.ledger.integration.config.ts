import { defineConfig } from 'vitest/config';

/**
 * Ledger hardware signer — fund-request flow smoke.
 *
 * Requires `.env.ledger.test` (see repo root `.env.ledger.test.example`).
 * Physical device: unlock, Ethereum app, quit Ledger Live.
 *
 * Run: `pnpm test:ledger` from `cli/`
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__integration__/**/*.ledger.integration.test.ts'],
    testTimeout: 600_000,
    // Vitest 4 removed poolOptions; fileParallelism is the replacement. A shared
    // signer EOA means concurrent files race on nonces.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    globalSetup: ['./test/global-setup-ledger.ts'],
  },
});
