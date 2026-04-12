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
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    globalSetup: ['./test/global-setup-ledger.ts'],
  },
});
