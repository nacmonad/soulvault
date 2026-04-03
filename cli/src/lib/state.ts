import fs from 'fs-extra';
import { resolveAgentProfilePath, resolveCliStateDir, resolveConfigPath, resolveKeysDir } from './paths.js';

export async function ensureStateDirs() {
  await fs.ensureDir(resolveCliStateDir());
  await fs.ensureDir(resolveKeysDir());
}

export async function readJsonIfExists<T>(file: string): Promise<T | null> {
  if (!(await fs.pathExists(file))) return null;
  return fs.readJson(file) as Promise<T>;
}

export async function writeConfig(config: unknown) {
  await ensureStateDirs();
  await fs.writeJson(resolveConfigPath(), config, { spaces: 2 });
}

export async function writeAgentProfile(profile: unknown) {
  await ensureStateDirs();
  await fs.writeJson(resolveAgentProfilePath(), profile, { spaces: 2 });
}

export async function readConfig<T>() {
  return readJsonIfExists<T>(resolveConfigPath());
}

export async function readAgentProfile<T>() {
  return readJsonIfExists<T>(resolveAgentProfilePath());
}
