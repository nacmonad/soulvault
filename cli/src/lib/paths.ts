import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveRepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
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
