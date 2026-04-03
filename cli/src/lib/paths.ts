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
