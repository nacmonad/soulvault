import { uploadBufferTo0G, downloadFrom0G } from './0g.js';
import type { ExternalSlotStore } from '@soulvault/protocol';

/**
 * Adapter that satisfies the protocol's ExternalSlotStore port with the
 * existing 0G Storage client. At integration time the 0G root hash is the
 * locator string; the protocol package itself carries no 0G dependency
 * (docs/adr/0001-external-slot-overflow-storage.md).
 */
export class ZeroGExternalSlotStore implements ExternalSlotStore {
  async put(bytes: Uint8Array): Promise<string> {
    const result = await uploadBufferTo0G(bytes);
    const rootHash = result && !Array.isArray((result as { rootHashes?: unknown }).rootHashes)
      ? (result as { rootHash?: string }).rootHash
      : undefined;
    if (typeof rootHash !== 'string' || rootHash === '') {
      throw new Error('0G upload did not return a single root hash');
    }
    return rootHash;
  }

  async get(locator: string): Promise<Uint8Array> {
    const { readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdtemp } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'soulvault-slot-'));
    const outputPath = join(dir, 'slot-record');
    await downloadFrom0G(locator, outputPath);
    const bytes = await readFile(outputPath);
    return new Uint8Array(bytes);
  }
}
