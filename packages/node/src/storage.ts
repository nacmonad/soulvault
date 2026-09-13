/**
 * Payload storage seam — swappable backend for swarm message payloads.
 *
 * Uploads always receive already-sealed envelopes (ECDH/AES-GCM done
 * client-side); this layer only persists opaque bytes and returns a locator
 * (`payloadRef`) that `downloadPayload()` can resolve. Backends:
 *
 *   - `0g`   (default): 0G Storage via the TS SDK. Ref = 0G root hash.
 *   - `file`         : local directory store for co-located demos/dev.
 *                      Ref = `file://<sha256-hex>` (content-addressed).
 *
 * Future backends (e.g. IPFS) follow the same contract: opaque ref in,
 * bytes out, backend never named outside this module.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from './config.js';
import { resolveRepoRoot } from './paths.js';

export type StorageUpload = {
  /** Opaque locator — safe to post on-chain as `payloadRef`. */
  payloadRef: string;
  backend: '0g' | 'file';
  txHash?: string | null;
};

export function storageBackend(): '0g' | 'file' {
  const env = loadEnv();
  const backend = (env.SOULVAULT_STORAGE_BACKEND ?? '0g').toLowerCase();
  if (backend !== '0g' && backend !== 'file') {
    throw new Error(`unknown SOULVAULT_STORAGE_BACKEND: ${backend} (expected "0g" or "file")`);
  }
  return backend;
}

function storageDir(): string {
  const env = loadEnv();
  return env.SOULVAULT_STORAGE_DIR ?? path.join(resolveRepoRoot(), '.soulvault-storage');
}

function isFileRef(payloadRef: string): boolean {
  return payloadRef.startsWith('file://');
}

/** Persist a JSON payload with the configured backend; returns the payloadRef. */
export async function uploadPayload(value: unknown): Promise<StorageUpload> {
  const backend = storageBackend();
  if (backend === 'file') {
    const bytes = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const dir = storageDir();
    await mkdir(dir, { recursive: true });
    // Content-addressed: writes are idempotent, duplicate uploads harmless.
    await writeFile(path.join(dir, hash), bytes);
    return { payloadRef: `file://${hash}`, backend, txHash: null };
  }
  // Lazy: the 0G path drags in the signer (Ledger DMK → node-hid native
  // binding). The `file` backend must never load that graph — it breaks
  // webpack server bundles on non-Linux hosts (native prebuilt mismatch).
  const { uploadJsonTo0G } = await import('./0g.js');
  const tx = (await uploadJsonTo0G(value)) as {
    rootHash?: string;
    rootHashes?: string[];
    txHash?: string;
    txHashes?: string[];
  };
  const rootHash = tx.rootHash ?? tx.rootHashes?.[0];
  if (!rootHash) throw new Error('0G upload returned no root hash');
  return {
    payloadRef: rootHash,
    backend,
    txHash: tx.txHash ?? tx.txHashes?.[0] ?? null,
  };
}

/** Resolve a payloadRef to its JSON envelope, regardless of backend. */
export async function downloadPayload(payloadRef: string): Promise<unknown> {
  if (isFileRef(payloadRef)) {
    const hash = payloadRef.slice('file://'.length);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`invalid file payloadRef: ${payloadRef}`);
    const bytes = await readFile(path.join(storageDir(), hash));
    return JSON.parse(bytes.toString('utf8'));
  }
  const { tmpdir } = await import('node:os');
  const tempPath = path.join(tmpdir(), `soulvault-payload-${Date.now()}.json`);
  const { downloadFrom0G } = await import('./0g.js');
  await downloadFrom0G(payloadRef, tempPath);
  return JSON.parse(await readFile(tempPath, 'utf8'));
}
