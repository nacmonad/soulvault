import crypto from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { loadEnv } from './config.js';
import { TEST_K_EPOCH_HEX } from './test-key.js';

export async function createWorkspaceArchive(workspacePath: string) {
  const outDir = path.join(os.tmpdir(), 'soulvault');
  await fs.ensureDir(outDir);
  const archivePath = path.join(outDir, `soulvault-${Date.now()}.tar.gz`);
  await tar.create({ gzip: true, file: archivePath, cwd: workspacePath }, ['.']);
  return archivePath;
}

export async function encryptArchiveWithEpochKey(archivePath: string) {
  const env = loadEnv();
  const keyHex = env.SOULVAULT_TEST_K_EPOCH || TEST_K_EPOCH_HEX;
  const key = Buffer.from(keyHex.replace(/^0x/, ''), 'hex');
  if (key.length !== 32) {
    throw new Error('SOULVAULT_TEST_K_EPOCH must be 32 bytes / 64 hex chars');
  }

  const plaintext = await fs.readFile(archivePath);
  const nonce = crypto.randomBytes(12);
  const aad = Buffer.from(JSON.stringify({ archivePath: path.basename(archivePath), algorithm: 'aes-256-gcm-test-scaffold' }));
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedPath = `${archivePath}.enc`;
  await fs.writeFile(encryptedPath, ciphertext);

  return {
    encryptedPath,
    manifest: {
      sourceArchive: archivePath,
      encryptedPath,
      archiveSha256: sha256Hex(plaintext),
      ciphertextSha256: sha256Hex(ciphertext),
      nonce: nonce.toString('hex'),
      authTag: authTag.toString('hex'),
      aad: aad.toString('utf8'),
      algorithm: 'aes-256-gcm-test-scaffold',
      keySource: env.SOULVAULT_TEST_K_EPOCH ? 'env' : 'const:TEST_K_EPOCH_HEX'
    }
  };
}

function sha256Hex(input: Uint8Array) {
  return crypto.createHash('sha256').update(input).digest('hex');
}
