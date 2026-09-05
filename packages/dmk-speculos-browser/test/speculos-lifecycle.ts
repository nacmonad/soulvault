import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export type SpeculosModel = 'nanosp' | 'nanox' | 'stax';

export type SpeculosLifecycleOptions = {
  appElfPath: string;
  image: string;
  model?: SpeculosModel;
  apiHost?: string;
  apiPort?: number;
  containerName?: string;
};

export function buildSpeculosDockerArgs(options: SpeculosLifecycleOptions): string[] {
  const appPath = resolve(options.appElfPath);
  const model = options.model ?? 'nanosp';
  const apiHost = options.apiHost ?? '127.0.0.1';
  const apiPort = options.apiPort ?? 5000;
  const containerName = options.containerName ?? 'soulvault-dmk-speculos-browser';
  return [
    'run', '--rm', '--name', containerName,
    '-p', `${apiHost}:${apiPort}:5000`,
    '-v', `${dirname(appPath)}:/speculos/apps:ro`,
    options.image,
    '--model', model,
    '--display', 'headless',
    '--apdu-port', '9999',
    '--api-port', '5000',
    `/speculos/apps/${basename(appPath)}`,
  ];
}

export async function startSpeculos(options: SpeculosLifecycleOptions): Promise<{
  apiUrl: string;
  stop(): Promise<void>;
}> {
  if (!existsSync(options.appElfPath)) {
    throw new Error(`Ledger Ethereum app ELF not found: ${resolve(options.appElfPath)}`);
  }
  execFileSync('docker', ['version'], { stdio: 'ignore' });
  const containerName = options.containerName ?? 'soulvault-dmk-speculos-browser';
  try {
    execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  } catch {
    // No stale container to remove.
  }
  const child: ChildProcess = spawn('docker', buildSpeculosDockerArgs(options), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const apiUrl = `http://${options.apiHost ?? '127.0.0.1'}:${options.apiPort ?? 5000}`;
  try {
    await waitUntilReachable(apiUrl, 30_000);
  } catch (cause) {
    child.kill('SIGTERM');
    throw cause;
  }
  return {
    apiUrl,
    async stop() {
      try {
        execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
      } finally {
        child.kill('SIGTERM');
      }
    },
  };
}

export async function isSpeculosReachable(apiUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/events?currentscreenonly=true`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReachable(apiUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isSpeculosReachable(apiUrl)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Speculos was not reachable at ${apiUrl} within ${timeoutMs}ms`);
}
