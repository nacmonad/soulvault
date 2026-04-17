/**
 * Vitest globalSetup for the Speculos integration suite.
 *
 * Responsibilities (in order):
 *   1. HOME isolation + .env.test load + forge build (mirrors global-setup.ts).
 *   2. Probe local chain.
 *   3. Speculos container:
 *        - If SOULVAULT_SPECULOS_API_URL is set AND reachable → reuse it.
 *        - Else spawn a new container via docker.ts (using SOULVAULT_SPECULOS_MODEL,
 *          SOULVAULT_SPECULOS_APP_ELF, seed.txt).
 *
 * Run with: `pnpm test:speculos`.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { resolveRepoRoot } from '../src/lib/paths.js';
import { probeChain } from './helpers/ens-probe.js';
import { startSpeculos, type SpeculosHandle } from './speculos/docker.js';
import { enableBlindSigning } from './speculos/configure-app.js';

let speculos: SpeculosHandle | undefined;

async function isSpeculosReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/events?currentscreenonly=true`);
    return res.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soulvault-speculos-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  const envTestPath = path.join(resolveRepoRoot(), '.env.speculos.test');
  if (!fs.existsSync(envTestPath)) {
    throw new Error(
      `.env.speculos.test not found at ${envTestPath}.\n` +
        `Copy .env.speculos.test.example to .env.speculos.test and adjust before running \`pnpm test:speculos\`.`,
    );
  }
  dotenv.config({ path: envTestPath, override: true });

  try {
    execSync('forge --version', { stdio: 'ignore' });
  } catch {
    throw new Error('`forge` not on PATH. Install Foundry before running Speculos integration tests.');
  }
  // eslint-disable-next-line no-console
  console.log('[speculos-setup] forge build...');
  execSync('forge build', { cwd: resolveRepoRoot(), stdio: 'inherit' });

  const rpcUrl = process.env.SOULVAULT_RPC_URL;
  if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set in .env.test');
  await probeChain({ rpcUrl, label: 'Local ens-app-v3 (SOULVAULT_RPC_URL)' });

  const model = (process.env.SOULVAULT_SPECULOS_MODEL ?? 'nanosp') as 'nanox' | 'nanosp' | 'stax';
  const defaultElfPath = path.join(resolveRepoRoot(), `cli/test/speculos/apps/${model}-ethereum.elf`);
  const appElf = process.env.SOULVAULT_SPECULOS_APP_ELF ?? defaultElfPath;
  const seedPath = path.join(resolveRepoRoot(), 'cli/test/speculos/seed.txt');
  const seed = fs.existsSync(seedPath) ? fs.readFileSync(seedPath, 'utf8').trim() : undefined;

  // Reuse already-running speculos (e.g. started via `docker compose up -d`).
  const existingUrl = process.env.SOULVAULT_SPECULOS_API_URL ?? 'http://127.0.0.1:5000';
  if (await isSpeculosReachable(existingUrl)) {
    // eslint-disable-next-line no-console
    console.log(`[speculos-setup] Reusing running Speculos at ${existingUrl}`);
    process.env.SOULVAULT_SPECULOS_API_URL = existingUrl;
  } else {
    // eslint-disable-next-line no-console
    console.log(`[speculos-setup] starting Speculos container (model=${model}, elf=${appElf})...`);
    speculos = await startSpeculos({ appElfPath: appElf, seed, apiPort: 5000, model });
    process.env.SOULVAULT_SPECULOS_API_URL = speculos.apiUrl;
    // eslint-disable-next-line no-console
    console.log(`[speculos-setup] Speculos ready at ${speculos.apiUrl}`);
  }

  // Ensure the Ethereum app accepts signing by enabling blind-signing.
  // Temporary until we wire ERC-7730 filter descriptors for SoulVault domains.
  try {
    const toggled = await enableBlindSigning({ apiUrl: process.env.SOULVAULT_SPECULOS_API_URL });
    // eslint-disable-next-line no-console
    console.log(`[speculos-setup] blind-signing ${toggled ? 'enabled' : 'already on'}.`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[speculos-setup] could not auto-enable blind-signing: ${err instanceof Error ? err.message : err}.\n` +
        'Tests that require signing opaque data will still fail with APDU 6a80.',
    );
  }

  return async () => {
    if (speculos) {
      await speculos.stop().catch(() => undefined);
    }
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
}
