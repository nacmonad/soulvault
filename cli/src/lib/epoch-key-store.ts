import crypto from 'node:crypto';
import fs from 'fs-extra';
import { resolveEpochKeyPath, resolveSwarmKeysDir } from './paths.js';

export type StoredEpochKey = {
  swarm: string;
  epoch: number;
  keyHex: string;
  keyFingerprint: string;
  createdAt: string;
  source: 'generated' | 'imported';
};

function fingerprint(keyHex: string) {
  return crypto.createHash('sha256').update(Buffer.from(keyHex.replace(/^0x/, ''), 'hex')).digest('hex');
}

export function generateEpochKeyHex() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

export async function storeEpochKey(input: { swarm: string; epoch: number; keyHex: string; source?: 'generated' | 'imported' }) {
  await fs.ensureDir(resolveSwarmKeysDir(input.swarm));
  const record: StoredEpochKey = {
    swarm: input.swarm,
    epoch: input.epoch,
    keyHex: input.keyHex,
    keyFingerprint: fingerprint(input.keyHex),
    createdAt: new Date().toISOString(),
    source: input.source ?? 'generated',
  };
  await fs.writeJson(resolveEpochKeyPath(input.swarm, input.epoch), record, { spaces: 2 });
  return record;
}

export async function readEpochKey(swarm: string, epoch: number) {
  const file = resolveEpochKeyPath(swarm, epoch);
  if (!(await fs.pathExists(file))) return null;
  return fs.readJson(file) as Promise<StoredEpochKey>;
}
