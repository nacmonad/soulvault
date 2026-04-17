/**
 * Minimal docker wrapper to run Speculos for integration tests.
 *
 * We shell out to `docker` rather than link dockerode to keep the test-only
 * dependency surface small. If `docker` is not on PATH, globalSetup fails
 * with a remediation message.
 *
 * Container contract:
 *   - image: ghcr.io/ledgerhq/speculos:latest
 *   - app ELF mounted at /speculos/apps
 *   - REST API exposed on host port 5000 (APDU + /events + /button + /screenshot)
 *   - VNC disabled (headless)
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface SpeculosOptions {
  image?: string;
  appElfPath: string;
  apiHost?: string;
  apiPort?: number;
  model?: 'nanox' | 'nanosp' | 'stax';
  seed?: string;
  containerName?: string;
}

export interface SpeculosHandle {
  containerName: string;
  apiUrl: string;
  stop: () => Promise<void>;
}

function ensureDockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'docker binary not found on PATH. Install Docker Desktop or engine before running Speculos integration tests.\n' +
        'See docs/clear-signing-runbook.md §1.',
    );
  }
}

export async function startSpeculos(opts: SpeculosOptions): Promise<SpeculosHandle> {
  ensureDockerAvailable();

  if (!fs.existsSync(opts.appElfPath)) {
    throw new Error(
      `Ledger app ELF not found at ${opts.appElfPath}.\n` +
        'Download the Ethereum Nano app ELF and place it there. See docs/clear-signing-runbook.md §2.',
    );
  }

  const image = opts.image ?? 'ghcr.io/ledgerhq/speculos:latest';
  const apiHost = opts.apiHost ?? '127.0.0.1';
  const apiPort = opts.apiPort ?? 5000;
  const model = opts.model ?? 'nanox';
  const containerName =
    opts.containerName ?? `soulvault-speculos-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;

  const appDir = path.dirname(path.resolve(opts.appElfPath));
  const appBase = path.basename(opts.appElfPath);

  // Best-effort clean previous stale container.
  try {
    execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }

  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
    '-p',
    `${apiHost}:${apiPort}:5000`,
    '-v',
    `${appDir}:/speculos/apps:ro`,
    image,
    '--model',
    model,
    '--display',
    'headless',
    '--apdu-port',
    '9999',
    '--api-port',
    '5000',
  ];
  if (opts.seed) args.push('--seed', opts.seed);
  args.push(`/speculos/apps/${appBase}`);

  // eslint-disable-next-line no-console
  console.log(`[speculos] docker ${args.join(' ')}`);
  const child: ChildProcess = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (d) => process.stderr.write(`[speculos] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[speculos!] ${d}`));

  const apiUrl = `http://${apiHost}:${apiPort}`;
  await waitForSpeculos(apiUrl, 30_000);

  return {
    containerName,
    apiUrl,
    async stop() {
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
      child.kill('SIGTERM');
    },
  };
}

async function waitForSpeculos(apiUrl: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiUrl}/events`);
      if (res.ok || res.status === 204) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Speculos REST API not reachable at ${apiUrl} within ${timeoutMs}ms. Last error: ${String(lastErr)}`,
  );
}
