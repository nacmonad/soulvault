import { MemData, ZgFile, Indexer } from '@0gfoundation/0g-ts-sdk';
import { readFile } from 'node:fs/promises';
import { loadEnv } from './config.js';
import { createSigner } from './signer.js';

export function createIndexer() {
  const env = loadEnv();
  return new Indexer(env.SOULVAULT_0G_INDEXER_URL);
}

export async function uploadFileTo0G(filePath: string) {
  const env = loadEnv();
  const signer = await createSigner();
  const indexer = createIndexer();
  const file = await ZgFile.fromFilePath(filePath);
  await file.merkleTree();
  const [tx, err] = await indexer.upload(file, env.SOULVAULT_RPC_URL, signer as any);
  if (err) throw err;
  return tx;
}

export async function uploadBufferTo0G(buffer: Uint8Array) {
  const env = loadEnv();
  const signer = await createSigner();
  const indexer = createIndexer();
  const memData = new MemData(buffer);
  const [tx, err] = await indexer.upload(memData, env.SOULVAULT_RPC_URL, signer as any);
  if (err) throw err;
  return tx;
}

export async function uploadJsonTo0G(value: unknown) {
  return uploadBufferTo0G(Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
}

export async function uploadPreparedArtifact(filePath: string) {
  const bytes = await readFile(filePath);
  return uploadBufferTo0G(bytes);
}
