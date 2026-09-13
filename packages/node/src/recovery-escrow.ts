import fs from 'fs-extra';
import path from 'node:path';
import { utf8ToBytes, bytesToHex, sha256Hex } from '@soulvault/protocol';
import {
  epochKeyName,
  escrowAad,
  openRingBackend,
  LocalDevRingBackend,
  type RingBackend,
} from './ring-backend.js';
import { resolveCliStateDir } from './paths.js';

/**
 * Recovery escrows — epoch key recovery without stored keys (spec v0.1).
 *
 * Format: plaintext JSON header \n body
 *   header = { v, kind, agentId, epoch, keyName, alg, generation?, createdAt,
 *              payloadSha256 }
 *   body   = ring-encrypted payload (backend-specific framing)
 *
 * AAD is bound to guessable fields only ({kind, agentId}) so the cycle path
 * (header loss) can sweep epoch names and let GCM authentication decide.
 */

export const ESCROW_KIND = 'soulvault-epoch-escrow';

export type EscrowHeader = {
  v: 1;
  kind: typeof ESCROW_KIND;
  agentId: string;
  epoch: number;
  keyName: string;
  alg: string;
  /** Local-ring generation at encryption time (absent for ledger backend). */
  generation?: number;
  createdAt: string;
  payloadSha256: string;
};

export type EscrowPaths = {
  headerPath: string;
  bodyPath: string;
};

function escrowDir(agentId: string, stateDir?: string): string {
  // agentId is an ENS name — safe as a directory segment after lowercasing
  return path.join(stateDir ?? resolveCliStateDir(), 'recovery-escrows', agentId.toLowerCase());
}

export function resolveEscrowPaths(agentId: string, epoch: number, stateDir?: string): EscrowPaths {
  const dir = escrowDir(agentId, stateDir);
  return {
    headerPath: path.join(dir, `epoch-${String(epoch).padStart(6, '0')}.header.json`),
    bodyPath: path.join(dir, `epoch-${String(epoch).padStart(6, '0')}.body.enc`),
  };
}

// ── Escrow (write) ──────────────────────────────────────────────────────────

export async function writeRecoveryEscrow(input: {
  agentId: string;
  epoch: number;
  payload: Uint8Array;
  backend?: RingBackend;
  stateDir?: string;
}): Promise<{ header: EscrowHeader; paths: EscrowPaths; bodySha256: string }> {
  const backend = input.backend ?? (await openRingBackend());
  const keyName = epochKeyName(input.agentId, input.epoch);
  const aad = escrowAad(input.agentId);

  const body = await backend.encrypt({ keyName, plaintext: input.payload, aad });

  const header: EscrowHeader = {
    v: 1,
    kind: ESCROW_KIND,
    agentId: input.agentId,
    epoch: input.epoch,
    keyName,
    alg: backend.alg,
    ...(backend.kind === 'local' ? { generation: (backend as LocalDevRingBackend).currentGeneration } : {}),
    createdAt: new Date().toISOString(),
    payloadSha256: sha256Hex(input.payload),
  };

  const paths = resolveEscrowPaths(input.agentId, input.epoch, input.stateDir);
  await fs.ensureDir(path.dirname(paths.headerPath));
  await fs.writeFile(paths.headerPath, JSON.stringify(header, null, 2));
  await fs.writeFile(paths.bodyPath, body);

  return { header, paths, bodySha256: sha256Hex(body) };
}

// ── Read helpers ────────────────────────────────────────────────────────────

export async function readEscrowHeader(agentId: string, epoch: number, stateDir?: string): Promise<EscrowHeader | null> {
  const { headerPath } = resolveEscrowPaths(agentId, epoch, stateDir);
  if (!(await fs.pathExists(headerPath))) return null;
  const header = (await fs.readJson(headerPath)) as EscrowHeader;
  return header.kind === ESCROW_KIND ? header : null;
}

async function readBody(agentId: string, epoch: number, stateDir?: string): Promise<Uint8Array> {
  const { bodyPath } = resolveEscrowPaths(agentId, epoch, stateDir);
  if (!(await fs.pathExists(bodyPath))) throw new Error(`escrow body missing: ${bodyPath}`);
  return new Uint8Array(await fs.readFile(bodyPath));
}

// ── Fast path: header intact → keyName → derive → decrypt ───────────────────

export async function fastRestore(input: {
  agentId: string;
  epoch: number;
  backend?: RingBackend;
  stateDir?: string;
}): Promise<{ header: EscrowHeader; payload: Uint8Array }> {
  const backend = input.backend ?? (await openRingBackend());
  const header = await readEscrowHeader(input.agentId, input.epoch, input.stateDir);
  if (!header) throw new Error(`no escrow header for ${input.agentId} epoch ${input.epoch} — cycle path required`);
  const body = await readBody(input.agentId, input.epoch, input.stateDir);
  const payload = await backend.decrypt({ keyName: header.keyName, body, aad: escrowAad(input.agentId) });
  if (header.payloadSha256 && sha256Hex(payload) !== header.payloadSha256) {
    throw new Error('payload hash mismatch after decrypt — escrow corrupted');
  }
  return { header, payload };
}

// ── Cycle path: header lost → sweep epoch names, GCM auth decides ───────────

export async function cycleRestore(input: {
  agentId: string;
  body: Uint8Array;
  maxEpoch?: number;
  backend?: RingBackend;
  stateDir?: string;
}): Promise<{ epoch: number; payload: Uint8Array }> {
  const backend = input.backend ?? (await openRingBackend());
  if (!backend.supportsCyclePath) {
    throw new Error(`backend ${backend.kind} cannot sweep epoch names (no raw derivation) — use fast path`);
  }
  const aad = escrowAad(input.agentId);
  const maxEpoch = input.maxEpoch ?? 64;
  for (let epoch = 1; epoch <= maxEpoch; epoch++) {
    try {
      const keyName = epochKeyName(input.agentId, epoch);
      const payload = await backend.decrypt({ keyName, body: input.body, aad });
      return { epoch, payload };
    } catch {
      /* wrong epoch — clean auth failure, keep sweeping */
    }
  }
  throw new Error(`no epoch in 1..${maxEpoch} authenticated for ${input.agentId}`);
}

/** Convenience: sweep over the stored body when the header file is gone. */
export async function cycleRestoreStored(input: {
  agentId: string;
  maxEpoch?: number;
  backend?: RingBackend;
  stateDir?: string;
}): Promise<{ epoch: number; payload: Uint8Array }> {
  const { bodyPath } = resolveEscrowPaths(input.agentId, 0, input.stateDir);
  const dir = path.dirname(bodyPath);
  if (!(await fs.pathExists(dir))) throw new Error(`no escrow directory for ${input.agentId}`);
  // Body files are epoch-named; sweep whichever bodies exist, newest epoch wins.
  const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.body.enc'));
  if (entries.length === 0) throw new Error(`no escrow bodies in ${dir}`);
  const epochs = entries
    .map((f) => Number.parseInt(f.replace('epoch-', '').replace('.body.enc', ''), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  const backend = input.backend ?? (await openRingBackend());
  for (const epoch of epochs) {
    const body = await readBody(input.agentId, epoch, input.stateDir);
    try {
      return await cycleRestore({ agentId: input.agentId, body, maxEpoch: input.maxEpoch, backend, stateDir: input.stateDir });
    } catch {
      /* keep trying other bodies */
    }
  }
  throw new Error(`cycle sweep exhausted for ${input.agentId}`);
}

// ── Sweep: post-kick rotation — decrypt pre-rotation, re-escrow post-rotation ──

export type SweepResult = {
  agentId: string;
  fromGeneration: number;
  toGeneration: number;
  reEscrowedEpochs: number[];
};

/**
 * Post-kick sweep: decrypt every surviving escrow under the pre-rotation
 * generation, rotate the ring, and re-escrow under the new generation.
 * Forward-looking revocation only — this MUST run after every member removal.
 */
export async function sweepAfterKick(input: {
  agentId: string;
  epochs?: number[];
  backend?: LocalDevRingBackend;
  stateDir?: string;
}): Promise<{ fromGeneration: number; toGeneration: number; reEscrowedEpochs: number[] }> {
  const backend = (input.backend ?? (await openRingBackend())) as LocalDevRingBackend;
  if (!(backend instanceof LocalDevRingBackend)) {
    throw new Error('sweep requires the local ring backend (raw derivation); ledger backend cannot sweep');
  }
  const fromGeneration = backend.currentGeneration;
  const dir = path.dirname(resolveEscrowPaths(input.agentId, 0, input.stateDir).headerPath);
  if (!(await fs.pathExists(dir))) throw new Error(`no escrow directory for ${input.agentId}`);

  const epochs = input.epochs ?? (await fs.readdir(dir))
    .filter((f) => f.endsWith('.body.enc'))
    .map((f) => Number.parseInt(f.replace('epoch-', '').replace('.body.enc', ''), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  // 1. Decrypt everything under the pre-rotation generation.
  const survivors: { epoch: number; payload: Uint8Array }[] = [];
  for (const epoch of epochs) {
    const header = await readEscrowHeader(input.agentId, epoch, input.stateDir);
    if (!header) continue;
    const body = await readBody(input.agentId, epoch, input.stateDir);
    try {
      const payload = await backend.decryptUnderGeneration(
        { keyName: header.keyName, body, aad: escrowAad(input.agentId) },
        header.generation ?? fromGeneration,
      );
      survivors.push({ epoch, payload });
    } catch {
      // pre-rotation ciphertext already dead — nothing to carry forward
    }
  }

  // 2. Rotate, then re-escrow under the new generation.
  const toGeneration = await backend.rotate();
  const reEscrowedEpochs: number[] = [];
  for (const s of survivors) {
    await writeRecoveryEscrow({
      agentId: input.agentId,
      epoch: s.epoch,
      payload: s.payload,
      backend,
      stateDir: input.stateDir,
    });
    reEscrowedEpochs.push(s.epoch);
  }

  return { fromGeneration, toGeneration, reEscrowedEpochs };
}
