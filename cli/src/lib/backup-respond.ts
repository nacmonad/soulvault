import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { encryptArchiveWithKey } from './backup.js';
import { readEpochKey } from './epoch-key-store.js';
import { uploadPreparedArtifact } from './0g.js';
import { getAgentProfile } from './agent.js';
import { getActiveSwarm } from './swarm.js';
import { updateMemberFileMappingOnchain } from './swarm-contract.js';
import { writeLastBackup } from './state.js';
import { loadEnv } from './config.js';

const exec = promisify(execCallback);

function toBytes32Hex(hexLike: string) {
  const value = hexLike.startsWith('0x') ? hexLike : `0x${hexLike}`;
  const raw = value.slice(2);
  if (raw.length === 64) return value;
  return `0x${raw.padStart(64, '0').slice(0, 64)}`;
}

function keccakFromJson(value: unknown) {
  return `0x${crypto.createHash('sha256').update(Buffer.from(JSON.stringify(value, null, 2), 'utf8')).digest('hex')}`;
}

function detectFundingError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return /insufficient|funds|gas|balance/i.test(msg);
}

export async function respondToBackupRequest(input: { swarm?: string; epoch: number; reason?: string }) {
  const swarm = input.swarm ? undefined : await getActiveSwarm();
  const swarmSlug = input.swarm ?? swarm?.slug;
  if (!swarmSlug) throw new Error('No swarm selected. Pass --swarm or set an active swarm first.');

  const epochKey = await readEpochKey(swarmSlug, input.epoch);
  if (!epochKey) {
    throw new Error(`No local epoch key found for swarm ${swarmSlug} epoch ${input.epoch}`);
  }

  const env = loadEnv();
  const workspace = path.resolve(env.SOULVAULT_WORKSPACE || process.cwd());
  const backupCommand = env.SOULVAULT_DEFAULT_BACKUP_COMMAND || 'openclaw backup create --output /tmp/soulvault-openclaw-backup.tar.gz --verify --no-include-workspace';
  const artifactPath = '/tmp/soulvault-openclaw-backup.tar.gz';
  await fs.remove(artifactPath);

  console.error('[backup-respond] running backup command', backupCommand);
  const { stdout, stderr } = await exec(backupCommand, {
    cwd: workspace,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  console.error('[backup-respond] backup stdout', stdout || '<empty>');
  console.error('[backup-respond] backup stderr', stderr || '<empty>');

  const exists = await fs.pathExists(artifactPath);
  console.error('[backup-respond] artifact exists', exists, artifactPath);
  if (!exists) {
    throw new Error(`Backup command completed without producing expected artifact at ${artifactPath}. stdout=${stdout || '<empty>'} stderr=${stderr || '<empty>'}`);
  }

  const archivePath = artifactPath;
  const encrypted = await encryptArchiveWithKey(archivePath, epochKey.keyHex, `local-key-store:${swarmSlug}:epoch-${input.epoch}`);

  let upload;
  try {
    console.error('[backup-respond] uploading encrypted artifact', encrypted.encryptedPath);
    upload = await uploadPreparedArtifact(encrypted.encryptedPath) as { rootHash?: string; txHash?: string; rootHashes?: string[]; txHashes?: string[] };
    console.error('[backup-respond] upload result', JSON.stringify(upload, null, 2));
  } catch (error) {
    if (detectFundingError(error)) {
      const agent = await getAgentProfile();
      throw new Error(`Backup upload failed: insufficient 0G gas/storage balance for agent wallet ${agent?.address ?? 'unknown'}. Top up the agent wallet and retry the backup response.`);
    }
    throw error;
  }

  const rootHash = upload.rootHash ?? upload.rootHashes?.[0];
  const publishTxHash = upload.txHash ?? upload.txHashes?.[0];
  if (!rootHash || !publishTxHash) {
    throw new Error('Backup upload did not return the expected rootHash/txHash');
  }

  const merkleRoot = toBytes32Hex(encrypted.manifest.ciphertextSha256);
  const manifestHash = toBytes32Hex(keccakFromJson(encrypted.manifest));
  const agent = await getAgentProfile();
  if (!agent) throw new Error('No local agent profile found. Run `soulvault agent create` first.');

  console.error('[backup-respond] publishing member file mapping');
  const mapping = await updateMemberFileMappingOnchain({
    swarm: swarmSlug,
    member: agent.address,
    storageLocator: rootHash,
    merkleRoot,
    publishTxHash: toBytes32Hex(publishTxHash),
    manifestHash,
    epoch: input.epoch,
  });

  const record = {
    createdAt: new Date().toISOString(),
    workspace,
    archivePath,
    encryptedPath: encrypted.encryptedPath,
    manifest: encrypted.manifest,
    upload,
    rootHash,
    txHash: publishTxHash,
    epoch: input.epoch,
    reason: input.reason,
    mapping,
  };
  await writeLastBackup(record);

  return record;
}
