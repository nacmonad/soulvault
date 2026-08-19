import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Walk upward from this module until the workspace root is found, so the
 * result stays correct whether this code runs from packages/node/src, a
 * bundled apps/cli/dist, or a Next.js server build.
 */
export function resolveRepoRoot(): string {
  let dir = __dirname;
  while (true) {
    if (
      fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(dir, 'foundry.toml'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Fell off the filesystem root — fall back to cwd rather than crash.
      return process.cwd();
    }
    dir = parent;
  }
}

export function resolveCliStateDir(): string {
  return path.join(os.homedir(), '.soulvault');
}

export function resolveConfigPath(): string {
  return path.join(resolveCliStateDir(), 'config.json');
}

export function resolveAgentProfilePath(): string {
  return path.join(resolveCliStateDir(), 'agent.json');
}

export function resolveKeysDir(): string {
  return path.join(resolveCliStateDir(), 'keys');
}

export function resolveOrganizationsDir(): string {
  return path.join(resolveCliStateDir(), 'organizations');
}

export function resolveSwarmsDir(): string {
  return path.join(resolveCliStateDir(), 'swarms');
}

export function resolveTreasuriesDir(): string {
  return path.join(resolveCliStateDir(), 'treasuries');
}

export function resolveTreasuryPath(orgSlug: string): string {
  return path.join(resolveTreasuriesDir(), `${orgSlug}.json`);
}

export function resolveOrganizationPath(nameOrSlug: string): string {
  return path.join(resolveOrganizationsDir(), `${nameOrSlug}.json`);
}

export function resolveSwarmPath(nameOrSlug: string): string {
  return path.join(resolveSwarmsDir(), `${nameOrSlug}.json`);
}

export function resolveSwarmKeysDir(swarmNameOrSlug: string): string {
  return path.join(resolveKeysDir(), swarmNameOrSlug);
}

export function resolveEpochKeyPath(swarmNameOrSlug: string, epoch: number | string): string {
  return path.join(resolveSwarmKeysDir(swarmNameOrSlug), `epoch-${epoch}.json`);
}

export function resolveLastBackupPath(): string {
  return path.join(resolveCliStateDir(), 'last-backup.json');
}
