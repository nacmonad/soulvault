import { MemData, ZgFile, Indexer } from '@0gfoundation/0g-ts-sdk';
import { readFile } from 'node:fs/promises';
import { loadEnv } from './config.js';
import { createSigner } from './signer.js';

export type UploadResult = {
  rootHash?: string;
  txHash?: string;
  rootHashes?: string[];
  txHashes?: string[];
};

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

export async function uploadPreparedArtifact(filePath: string): Promise<UploadResult> {
  const bytes = await readFile(filePath);
  return uploadBufferTo0G(bytes) as Promise<UploadResult>;
}

export async function downloadFrom0G(rootHash: string, outputPath: string) {
  const indexer = createIndexer();
  const err = await indexer.download(rootHash, outputPath, true);
  if (err) throw err;
  return { rootHash, outputPath };
}
