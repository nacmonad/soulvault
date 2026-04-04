import fs from 'fs-extra';
import { resolveAgentProfilePath, resolveCliStateDir, resolveConfigPath, resolveKeysDir, resolveLastBackupPath, resolveOrganizationsDir, resolveSwarmsDir } from './paths.js';

export async function ensureStateDirs() {
  await fs.ensureDir(resolveCliStateDir());
  await fs.ensureDir(resolveKeysDir());
  await fs.ensureDir(resolveOrganizationsDir());
  await fs.ensureDir(resolveSwarmsDir());
}

export async function readJsonIfExists<T>(file: string): Promise<T | null> {
  if (!(await fs.pathExists(file))) return null;
  return fs.readJson(file) as Promise<T>;
}

export async function writeConfig(config: unknown) {
  await ensureStateDirs();
  const existing = await readJsonIfExists<Record<string, unknown>>(resolveConfigPath());
  const merged = { ...(existing ?? {}), ...(config as Record<string, unknown>) };
  await fs.writeJson(resolveConfigPath(), merged, { spaces: 2 });
}

export async function writeAgentProfile(profile: unknown) {
  await ensureStateDirs();
  const existing = await readJsonIfExists<Record<string, unknown>>(resolveAgentProfilePath());
  const merged = { ...(existing ?? {}), ...(profile as Record<string, unknown>) };
  await fs.writeJson(resolveAgentProfilePath(), merged, { spaces: 2 });
}

export async function readConfig<T>() {
  return readJsonIfExists<T>(resolveConfigPath());
}

export async function readAgentProfile<T>() {
  return readJsonIfExists<T>(resolveAgentProfilePath());
}

export async function writeLastBackup(record: unknown) {
  await ensureStateDirs();
  await fs.writeJson(resolveLastBackupPath(), record, { spaces: 2 });
}

export async function readLastBackup<T>() {
  return readJsonIfExists<T>(resolveLastBackupPath());
}
