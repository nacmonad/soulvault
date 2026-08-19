import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import {
  aesGcmSeal,
  bytesToHex,
  hexToBytesFlexible,
  randomBytes,
  sha256Hex,
  utf8ToBytes,
} from '@soulvault/protocol';
import { loadEnv } from './config.js';
import { TEST_K_EPOCH_HEX } from './test-key.js';

export async function createWorkspaceArchive(workspacePath: string) {
  const outDir = path.join(os.tmpdir(), 'soulvault');
  await fs.ensureDir(outDir);
  const archivePath = path.join(outDir, `soulvault-${Date.now()}.tar.gz`);
  await tar.create({ gzip: true, file: archivePath, cwd: workspacePath }, ['.']);
  return archivePath;
}

export async function encryptArchiveWithKey(archivePath: string, keyHex: string, keySource = 'provided') {
  const key = hexToBytesFlexible(keyHex);
  if (key.length !== 32) {
    throw new Error('Epoch key must be 32 bytes / 64 hex chars');
  }

  const plaintext = new Uint8Array(await fs.readFile(archivePath));
  const nonce = randomBytes(12);
  const aadText = JSON.stringify({ archivePath: path.basename(archivePath), algorithm: 'aes-256-gcm-test-scaffold' });
  const { ciphertext, tag } = aesGcmSeal({ key, nonce, plaintext, aad: utf8ToBytes(aadText) });

  const encryptedPath = `${archivePath}.enc`;
  await fs.writeFile(encryptedPath, ciphertext);

  return {
    encryptedPath,
    manifest: {
      sourceArchive: archivePath,
      encryptedPath,
      archiveSha256: sha256Hex(plaintext),
      ciphertextSha256: sha256Hex(ciphertext),
      nonce: bytesToHex(nonce),
      authTag: bytesToHex(tag),
      aad: aadText,
      algorithm: 'aes-256-gcm-test-scaffold',
      keySource
    }
  };
}

export async function encryptArchiveWithEpochKey(archivePath: string) {
  const env = loadEnv();
  const keyHex = env.SOULVAULT_TEST_K_EPOCH || TEST_K_EPOCH_HEX;
  return encryptArchiveWithKey(archivePath, keyHex, env.SOULVAULT_TEST_K_EPOCH ? 'env' : 'const:TEST_K_EPOCH_HEX');
}
