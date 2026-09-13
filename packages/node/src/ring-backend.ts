import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import crypto from 'node:crypto';
import path from 'node:path';
import { aesGcmSeal, aesGcmOpen, randomBytes, hexToBytesFlexible, bytesToHex } from '@soulvault/protocol';
import { resolveCliStateDir } from './paths.js';

/**
 * RingBackend seam — key derivation + payload encryption without key storage.
 *
 * - `LedgerRingBackend`: real LKRP via Ledger's `wallet-cli ring` binary.
 *   Derivation happens inside the LKRP stack; raw key bytes are never exposed,
 *   so this backend supports fast-path encrypt/decrypt only (no cycle-path
 *   sweep, which needs raw derivation).
 * - `LocalDevRingBackend`: HKDF + AES-256-GCM simulation of LKRP semantics
 *   (demo/test mode, clearly labeled). Supports the full surface including
 *   rotation + sweep because it can derive raw keys in memory.
 *
 * See docs/epoch-key-ring-spec.md for the key naming and escrow format.
 */

export type RingBackend = {
  readonly kind: 'ledger' | 'local';
  /** Human-readable label recorded in escrow headers. */
  readonly alg: string;
  /** Encrypt payload under the named key. Returns the escrow body bytes. */
  encrypt(input: { keyName: string; plaintext: Uint8Array; aad: Uint8Array }): Promise<Uint8Array>;
  /** Decrypt escrow body. Throws on auth failure or missing membership. */
  decrypt(input: { keyName: string; body: Uint8Array; aad: Uint8Array }): Promise<Uint8Array>;
  /** True when the backend can sweep epoch names (raw derivation available). */
  readonly supportsCyclePath: boolean;
};

const RING_SALT = 'soulvault-epoch-ring-v1';

export function epochKeyName(agentId: string, epoch: number): string {
  return `soulvault:epoch-recovery:${agentId}:epoch-${String(epoch).padStart(6, '0')}`;
}

/** AAD is bound to guessable fields only, so the cycle path can reconstruct it (spec §4). */
export function escrowAad(agentId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ kind: 'soulvault-epoch-escrow', agentId }));
}

// ── LocalDevRingBackend (simulated LKRP — demo/test mode) ───────────────────

type LocalRingState = { seedHex: string; generation: number; createdAt: string };

function ringStateFile(stateDir?: string): string {
  return path.join(stateDir ?? resolveCliStateDir(), 'ring-local', 'state.json');
}

async function loadOrCreateRingState(file: string): Promise<LocalRingState> {
  if (await fs.pathExists(file)) return fs.readJson(file) as Promise<LocalRingState>;
  const state: LocalRingState = {
    seedHex: bytesToHex(randomBytes(32)),
    generation: 0,
    createdAt: new Date().toISOString(),
  };
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, state, { spaces: 2 });
  return state;
}

function hkdfKey(seed: Uint8Array, keyName: string, generation: number): Uint8Array {
  const info = new TextEncoder().encode(`${keyName}#gen${generation}`);
  return new Uint8Array(crypto.hkdfSync('sha256', seed, new TextEncoder().encode(RING_SALT), info, 32));
}

export class LocalDevRingBackend implements RingBackend {
  readonly kind = 'local' as const;
  readonly alg = 'AES-256-GCM/local-ring-v1 (SIMULATED — not device-backed)';
  readonly supportsCyclePath = true;
  private seed: Uint8Array;
  private generation: number;
  private stateFile: string;

  private constructor(seed: Uint8Array, generation: number, stateFile: string) {
    this.seed = seed;
    this.generation = generation;
    this.stateFile = stateFile;
  }

  static async open(stateDir?: string): Promise<LocalDevRingBackend> {
    const file = ringStateFile(stateDir);
    const state = await loadOrCreateRingState(file);
    return new LocalDevRingBackend(hexToBytesFlexible(state.seedHex), state.generation, file);
  }

  get currentGeneration(): number {
    return this.generation;
  }

  /** Rotation: derivation material changes; pre-rotation ciphertext dies. */
  async rotate(): Promise<number> {
    this.generation += 1;
    const state = await fs.readJson(this.stateFile);
    state.generation = this.generation;
    await fs.writeJson(this.stateFile, state, { spaces: 2 });
    return this.generation;
  }

  async encrypt(input: { keyName: string; plaintext: Uint8Array; aad: Uint8Array }): Promise<Uint8Array> {
    const key = hkdfKey(this.seed, input.keyName, this.generation);
    const nonce = randomBytes(12);
    const { ciphertext, tag } = aesGcmSeal({ key, nonce, plaintext: input.plaintext, aad: input.aad });
    const body = new Uint8Array(12 + ciphertext.length + tag.length);
    body.set(nonce, 0);
    body.set(ciphertext, 12);
    body.set(tag, 12 + ciphertext.length);
    return body;
  }

  async decrypt(input: { keyName: string; body: Uint8Array; aad: Uint8Array }): Promise<Uint8Array> {
    return this.decryptUnderGeneration(input, this.generation);
  }

  /** Decrypt under a specific generation (used by the post-kick sweep). */
  async decryptUnderGeneration(
    input: { keyName: string; body: Uint8Array; aad: Uint8Array },
    generation: number,
  ): Promise<Uint8Array> {
    if (input.body.length < 12 + 16) throw new Error('escrow body too short');
    const nonce = input.body.subarray(0, 12);
    const tag = input.body.subarray(input.body.length - 16);
    const ciphertext = input.body.subarray(12, input.body.length - 16);
    const key = hkdfKey(this.seed, input.keyName, generation);
    return aesGcmOpen({ key, nonce, ciphertext, tag, aad: input.aad });
  }
}

// ── LedgerRingBackend (real wallet-cli) ─────────────────────────────────────

export class LedgerRingBackend implements RingBackend {
  readonly kind = 'ledger' as const;
  readonly alg = 'LKRP/AES-256-GCM via wallet-cli';
  readonly supportsCyclePath = false; // LKRP never exposes raw derived key bytes
  private binary: string;

  constructor(binary = process.env.SOULVAULT_WALLET_CLI ?? 'wallet-cli') {
    this.binary = binary;
  }

  private run(args: string[], input?: Buffer): Buffer {
    return execFileSync(this.binary, ['ring', ...args], {
      input,
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  async encrypt(input: { keyName: string; plaintext: Uint8Array; aad: Uint8Array }): Promise<Uint8Array> {
    // wallet-cli owns framing end-to-end for its backend: the CLI surface has
    // no AAD passthrough, so AAD integrity is enforced at the escrow framing
    // layer (recovery-escrow.ts) and keyName scoping carries the agent binding.
    return new Uint8Array(this.run(['encrypt', '--key', input.keyName], Buffer.from(input.plaintext)));
  }

  async decrypt(input: { keyName: string; body: Uint8Array; aad: Uint8Array }): Promise<Uint8Array> {
    return new Uint8Array(this.run(['decrypt', '--key', input.keyName], Buffer.from(input.body)));
  }
}

export async function openRingBackend(preferred?: string): Promise<RingBackend> {
  const choice = preferred ?? process.env.SOULVAULT_RING_BACKEND ?? 'local';
  if (choice === 'ledger') return new LedgerRingBackend();
  return LocalDevRingBackend.open();
}
