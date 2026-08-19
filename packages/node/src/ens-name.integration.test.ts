/**
 * Chain smoke tests (read-only). Run from repo root with `.env` configured:
 *   cd cli && SOULVAULT_INTEGRATION=1 pnpm test
 *
 * Does not register names or spend gas. Validates RPC + controller wiring used by `register-ens`.
 */
import { describe, expect, it } from 'vitest';
import { getEthRegistrarController } from './ens.js';

describe.skipIf(process.env.SOULVAULT_INTEGRATION !== '1')('ENS lane integration (Sepolia read-only)', () => {
  it('ETHRegistrarController minCommitmentAge is positive', async () => {
    const controller = await getEthRegistrarController(false);
    const age = BigInt(await controller.minCommitmentAge());
    expect(age).toBeGreaterThan(0n);
  }, 60_000);
});
