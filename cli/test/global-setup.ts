import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveRepoRoot } from '../src/lib/paths.js';
import { probeChain } from './helpers/ens-probe.js';

/**
 * Vitest globalSetup for integration tests.
 *
 * Runs once before any test file is loaded. Responsibilities:
 *   1. Isolate HOME to a temp dir so CLI state writes (`~/.soulvault/...`)
 *      don't clobber the developer's real profile.
 *   2. Load .env.test and override process.env (the CLI's dotenv only reads
 *      .env, and we need to override ENV vars for tests).
 *   3. Run `forge build` from the repo root so Foundry artifacts are fresh.
 *   4. Probe the configured ENS RPC endpoint to confirm ens-app-v3 (or whatever
 *      local node) is reachable before tests start. Fail loudly if not.
 *
 * Teardown: remove the temp HOME directory.
 */
export default async function globalSetup() {
  // 1. Isolated HOME
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soulvault-test-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  // 2. Load .env.test with override so values trump whatever was in process.env
  const envTestPath = path.join(resolveRepoRoot(), '.env.test');
  if (!fs.existsSync(envTestPath)) {
    throw new Error(
      `.env.test not found at ${envTestPath}.\n` +
        `Copy .env.example to .env.test and fill in the local ens-app-v3 values before running integration tests.`,
    );
  }
  dotenv.config({ path: envTestPath, override: true });

  // 3. Forge build — ensures out/ is up to date for artifact loading.
  try {
    execSync('forge --version', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'The `forge` binary is not on PATH. Install Foundry from https://getfoundry.sh/ before running integration tests.',
    );
  }
  // eslint-disable-next-line no-console
  console.log('[global-setup] Running forge build...');
  execSync('forge build', { cwd: resolveRepoRoot(), stdio: 'inherit' });

  // 4. Probe the ENS / ops RPC. In the collapsed single-chain setup they're the
  //    same node, but we probe them independently so a misconfig surfaces early.
  const rpcUrl = process.env.SOULVAULT_RPC_URL;
  const ensRpcUrl = process.env.SOULVAULT_ENS_RPC_URL;
  const expectedChainId = process.env.SOULVAULT_CHAIN_ID ? Number(process.env.SOULVAULT_CHAIN_ID) : undefined;

  if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set in .env.test');
  if (!ensRpcUrl) throw new Error('SOULVAULT_ENS_RPC_URL not set in .env.test');

  // eslint-disable-next-line no-console
  console.log(`[global-setup] Probing ops RPC ${rpcUrl} (expected chain ${expectedChainId ?? '?'})...`);
  await probeChain({
    rpcUrl,
    expectedChainId,
    label: 'Ops-lane node (SOULVAULT_RPC_URL)',
  });

  if (ensRpcUrl !== rpcUrl) {
    // eslint-disable-next-line no-console
    console.log(`[global-setup] Probing ENS RPC ${ensRpcUrl}...`);
    await probeChain({
      rpcUrl: ensRpcUrl,
      label: 'Identity-lane node (SOULVAULT_ENS_RPC_URL)',
    });
  }

  // eslint-disable-next-line no-console
  console.log('[global-setup] Ready.');

  // Teardown: restore HOME and remove the temp dir.
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
