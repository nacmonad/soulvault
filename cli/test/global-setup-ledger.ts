import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveRepoRoot } from '../src/lib/paths.js';
import { probeChain } from './helpers/ens-probe.js';

/**
 * Vitest globalSetup for Ledger hardware integration tests.
 *
 * Same isolation + forge build + RPC probes as `global-setup.ts`, but loads
 * `.env.ledger.test` from the repo root (see `.env.ledger.test.example`).
 */
export default async function globalSetupLedger() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soulvault-ledger-test-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  const envPath = path.join(resolveRepoRoot(), '.env.ledger.test');
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `.env.ledger.test not found at ${envPath}.\n` +
        `Copy .env.ledger.test.example to .env.ledger.test and fill in RPC, funder key, and SOULVAULT_LEDGER_TEST_ADDRESS.`,
    );
  }
  dotenv.config({ path: envPath, override: true });

  if (process.env.SOULVAULT_SIGNER_MODE !== 'ledger') {
    throw new Error(
      'Ledger integration tests require SOULVAULT_SIGNER_MODE=ledger in .env.ledger.test.',
    );
  }
  if (!process.env.SOULVAULT_LEDGER_TEST_ADDRESS?.trim()) {
    throw new Error('SOULVAULT_LEDGER_TEST_ADDRESS is required in .env.ledger.test.');
  }

  try {
    execSync('forge --version', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'The `forge` binary is not on PATH. Install Foundry from https://getfoundry.sh/ before running Ledger integration tests.',
    );
  }
  // eslint-disable-next-line no-console
  console.log('[global-setup-ledger] Running forge build...');
  execSync('forge build', { cwd: resolveRepoRoot(), stdio: 'inherit' });

  const rpcUrl = process.env.SOULVAULT_RPC_URL;
  const ensRpcUrl = process.env.SOULVAULT_ENS_RPC_URL;
  const expectedChainId = process.env.SOULVAULT_CHAIN_ID ? Number(process.env.SOULVAULT_CHAIN_ID) : undefined;

  if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set in .env.ledger.test');
  if (!ensRpcUrl) throw new Error('SOULVAULT_ENS_RPC_URL not set in .env.ledger.test');

  // eslint-disable-next-line no-console
  console.log(`[global-setup-ledger] Probing ops RPC ${rpcUrl} (expected chain ${expectedChainId ?? '?'})...`);
  await probeChain({
    rpcUrl,
    expectedChainId,
    label: 'Ops-lane node (SOULVAULT_RPC_URL)',
  });

  if (ensRpcUrl !== rpcUrl) {
    // eslint-disable-next-line no-console
    console.log(`[global-setup-ledger] Probing ENS RPC ${ensRpcUrl}...`);
    await probeChain({
      rpcUrl: ensRpcUrl,
      label: 'Identity-lane node (SOULVAULT_ENS_RPC_URL)',
    });
  }

  // eslint-disable-next-line no-console
  console.log('[global-setup-ledger] Ready (connect Ledger + open Ethereum app before tests run).');

  return async () => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
}
