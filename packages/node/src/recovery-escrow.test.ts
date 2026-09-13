import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  writeRecoveryEscrow,
  fastRestore,
  cycleRestoreStored,
  sweepAfterKick,
  readEscrowHeader,
} from './recovery-escrow.js';
import { LocalDevRingBackend, epochKeyName } from './ring-backend.js';

const AGENT = 'charlie.test.soulvault-ensv2.eth';
const PAYLOAD = new TextEncoder().encode(
  '# Charlie — harness memory (epoch 3)\n- derive, do not store\n',
);

async function tmpStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'soulvault-ring-test-'));
}

describe('recovery escrow (local ring backend)', () => {
  let stateDir: string;
  let backend: LocalDevRingBackend;

  beforeAll(async () => {
    stateDir = await tmpStateDir();
    backend = await LocalDevRingBackend.open(stateDir);
  });

  afterAll(async () => {
    await fs.remove(stateDir);
  });

  it('escrow → fast-path restore round-trips byte-identically', async () => {
    await writeRecoveryEscrow({ agentId: AGENT, epoch: 3, payload: PAYLOAD, backend, stateDir });
    const { payload } = await fastRestore({ agentId: AGENT, epoch: 3, backend, stateDir });
    expect(Buffer.from(payload).equals(Buffer.from(PAYLOAD))).toBe(true);
  });

  it('fast restore rejects a corrupted body (GCM auth)', async () => {
    await writeRecoveryEscrow({ agentId: AGENT, epoch: 4, payload: PAYLOAD, backend, stateDir });
    const { resolveEscrowPaths } = await import('./recovery-escrow.js');
    const paths = resolveEscrowPaths(AGENT, 4, stateDir);
    const body = await fs.readFile(paths.bodyPath);
    body[body.length - 1] ^= 0xff; // flip a tag byte
    await fs.writeFile(paths.bodyPath, body);
    await expect(fastRestore({ agentId: AGENT, epoch: 4, backend, stateDir })).rejects.toThrow();
  });

  it('cycle path recovers with the header destroyed', async () => {
    const { resolveEscrowPaths } = await import('./recovery-escrow.js');
    const header = await readEscrowHeader(AGENT, 3, stateDir);
    expect(header).not.toBeNull();
    await fs.remove(resolveEscrowPaths(AGENT, 3, stateDir).headerPath); // destroy the header
    const r = await cycleRestoreStored({ agentId: AGENT, backend, stateDir, maxEpoch: 16 });
    expect(r.epoch).toBe(3);
    expect(Buffer.from(r.payload).equals(Buffer.from(PAYLOAD))).toBe(true);
  });

  it('keyName format is ENS-scoped per spec', () => {
    expect(epochKeyName(AGENT, 3)).toBe(
      'soulvault:epoch-recovery:charlie.test.soulvault-ensv2.eth:epoch-000003',
    );
  });

  it('sweep after kick: pre-rotation escrow dead, survivors re-escrowed under new generation', async () => {
    await writeRecoveryEscrow({ agentId: AGENT, epoch: 5, payload: PAYLOAD, backend, stateDir });
    const before = backend.currentGeneration;
    const result = await sweepAfterKick({ agentId: AGENT, backend, stateDir });
    expect(result.toGeneration).toBe(before + 1);
    expect(result.reEscrowedEpochs).toContain(5);

    // post-rotation, fast restore works against the re-escrowed epoch
    const { payload } = await fastRestore({ agentId: AGENT, epoch: 5, backend, stateDir });
    expect(Buffer.from(payload).equals(Buffer.from(PAYLOAD))).toBe(true);
  });
});
