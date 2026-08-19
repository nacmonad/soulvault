import fs from 'fs-extra';
import { aesGcmOpen, hexToBytesFlexible, utf8ToBytes } from '@soulvault/protocol';
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
  const ciphertext = new Uint8Array(await fs.readFile(input.encryptedPath));
  const plaintext = aesGcmOpen({
    key: hexToBytesFlexible(keyHex),
    nonce: hexToBytesFlexible(input.nonceHex),
    ciphertext,
    tag: hexToBytesFlexible(input.authTagHex),
    aad: utf8ToBytes(input.aad),
  });
  await fs.writeFile(input.outputPath, plaintext);
}
