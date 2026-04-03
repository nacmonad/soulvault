import crypto from 'node:crypto';
import fs from 'fs-extra';
import { loadEnv } from './config.js';
import { TEST_K_EPOCH_HEX } from './test-key.js';

export async function decryptArchiveWithEpochKey(input: {
  encryptedPath: string;
  outputPath: string;
  nonceHex: string;
  aad: string;
  authTagHex: string;
}) {
  const env = loadEnv();
  const keyHex = env.SOULVAULT_TEST_K_EPOCH || TEST_K_EPOCH_HEX;
  const key = Buffer.from(keyHex.replace(/^0x/, ''), 'hex');
  const ciphertext = await fs.readFile(input.encryptedPath);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(input.nonceHex, 'hex'));
  decipher.setAAD(Buffer.from(input.aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(input.authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  await fs.writeFile(input.outputPath, plaintext);
}
