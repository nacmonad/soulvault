#!/usr/bin/env node
/**
 * Epoch Key Ring demo — harness-memory recovery without stored keys.
 *
 * Zero dependencies. Simulates the Ledger Key Ring Protocol semantics locally:
 *   - enrollment (one-time, device-gated in production)
 *   - derive-don't-store: keys are HKDF-derived from trustchain material + name
 *   - AES-256-GCM escrows, AAD bound to GUESSABLE fields only (so cycle-path works)
 *   - fast-path restore, cycle-path restore (name sweep), kick + rotation sweep
 *
 * Run: node demo.mjs
 */

import { webcrypto as crypto } from 'node:crypto';

// ─────────────────────────────────────────────────────────────
// Crypto primitives (what wallet-cli ring does under the hood)
// ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

const subtle = crypto.subtle;

async function hkdf(ikm, info, length = 32) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('soulvault-epoch-ring-v1'), info: enc.encode(info) },
    key,
    length * 8,
  );
  return Buffer.from(bits);
}

async function aesKey(raw) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function gcmEncrypt(keyRaw, plaintext, aad) {
  const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
  const k = await aesKey(keyRaw);
  const ct = Buffer.from(
    await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(aad) }, k, plaintext),
  );
  return Buffer.concat([iv, ct]);
}

async function gcmDecrypt(keyRaw, blob, aad) {
  const iv = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  const k = await aesKey(keyRaw);
  return Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(aad) }, k, ct));
}

// ─────────────────────────────────────────────────────────────
// Simulated Ledger Key Ring (LocalDevRing)
// In production: wallet-cli ring init / encrypt / decrypt
// ─────────────────────────────────────────────────────────────

/**
 * AAD covers only fields an attacker cannot profitably swap AND a recovering
 * agent can reconstruct during a cycle-sweep: kind + agentId. (Epoch is left
 * out deliberately — the header is trusted for it in the fast path, and the
 * sweep brute-forces it in the cycle path. GCM auth still prevents tampering
 * with kind/agentId.)
 */
function aadFor(agentId) {
  return enc.encode(JSON.stringify({ kind: 'soulvault-epoch-escrow', agentId }));
}

class LocalDevRing {
  constructor(label, seed = null) {
    this.label = label;
    this.members = new Set();
    this.generation = 0;
    this.seed = seed ?? Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  }

  /** One-time, device-gated. This is the ONLY Ledger tap. */
  enroll(agentId) {
    console.log(`   [ring:${this.label}] ${agentId} enrolled (Ledger tap — one time)`);
    this.members.add(agentId);
  }

  remove(agentId) {
    this.members.delete(agentId);
  }

  /** Rotation: trustchain rolls; derivation material changes. */
  rotate() {
    this.generation += 1;
  }

  /** Keys are derived, never stored. The name is the recipe. */
  async derive(keyName) {
    if (this.members.size === 0) throw new Error('no enrolled members — trustchain restore fails');
    // generation mixes into derivation, like LKRP rotation changes trustchain state
    return hkdf(this.seed, `${keyName}#gen${this.generation}`);
  }

  keyName(agentId, epoch) {
    return `soulvault:epoch-recovery:${agentId}:epoch-${String(epoch).padStart(6, '0')}`;
  }

  /** Pre-rotation derivation snapshot, used by the sweep after a kick. */
  preRotationRing() {
    return new LocalDevRing(`${this.label}@pre-rotation`, this.seed);
  }
}

// ─────────────────────────────────────────────────────────────
// Escrow: plaintext header \n IV || AES-256-GCM(ct, aad)
// ─────────────────────────────────────────────────────────────

async function writeEscrow(ring, agentId, epoch, payload) {
  const header = {
    v: 1,
    kind: 'soulvault-epoch-escrow',
    agentId,
    epoch,
    keyName: ring.keyName(agentId, epoch),
    alg: 'AES-256-GCM',
    createdAt: new Date().toISOString(),
  };
  const headerBytes = enc.encode(JSON.stringify(header) + '\n');
  const key = await ring.derive(header.keyName);
  const body = await gcmEncrypt(key, payload, aadFor(agentId));
  return Buffer.concat([headerBytes, body]);
}

function readHeader(escrow) {
  const nl = escrow.indexOf(0x0a);
  if (nl === -1) return null;
  try {
    const h = JSON.parse(dec.decode(escrow.subarray(0, nl)));
    return h.kind === 'soulvault-epoch-escrow' ? h : null;
  } catch {
    return null;
  }
}

function bodyOf(escrow) {
  return escrow.subarray(escrow.indexOf(0x0a) + 1);
}

/** Fast path: header intact → keyName → derive → decrypt. */
async function fastRestore(ring, escrow) {
  const header = readHeader(escrow);
  if (!header) throw new Error('header unreadable — cycle path required');
  const key = await ring.derive(header.keyName);
  return { header, payload: await gcmDecrypt(key, bodyOf(escrow), aadFor(header.agentId)) };
}

/** Cycle path: header lost → sweep epoch names; GCM auth picks the winner. */
async function cycleRestore(ring, agentId, bodylessEscrowBody, maxEpoch = 64) {
  for (let e = 1; e <= maxEpoch; e++) {
    try {
      const key = await ring.derive(ring.keyName(agentId, e));
      return { epoch: e, payload: await gcmDecrypt(key, bodylessEscrowBody, aadFor(agentId)) };
    } catch {
      /* wrong epoch — clean auth failure, keep sweeping */
    }
  }
  throw new Error(`no epoch in 1..${maxEpoch} authenticated`);
}

// ─────────────────────────────────────────────────────────────
// Demo scenario
// ─────────────────────────────────────────────────────────────

const H1 = (t) => console.log(`\n━━━ ${t} ━━━`);
const HMEMORIES = `# Atlas — harness memory (epoch 3)
- Learned: swarm quorum flow uses MemberFileMappingUpdated events
- Lesson: 0G upload needs rootHash + txHash verified before publish
- Context: working on ETHOnline 2026 Ledger Key Ring integration
`;

(async () => {
  const ring = new LocalDevRing('main');
  let ok = 0;
  const check = (name, cond) => {
    ok += cond ? 1 : 0;
    console.log(`   ${cond ? '✅' : '❌'} ${name}`);
  };

  H1('1. Agent "atlas" backs up harness memories at epoch 3');
  console.log(`   $ soulvault recovery escrow --agent atlas --epoch 3 --archive memories.md`);
  ring.enroll('atlas');
  const escrow = await writeEscrow(ring, 'atlas', 3, enc.encode(HMEMORIES));
  console.log(`   escrow written: ${escrow.length} bytes (header plaintext, body GCM-encrypted)`);
  console.log('   keys on disk at rest: ZERO — derived in memory, then discarded');

  H1('2. Atlas dies. Fresh instance, zero local state → fast-path restore');
  console.log(`   $ soulvault recovery restore --agent atlas --epoch 3`);
  ring.enroll('atlas-v2');
  const fast = await fastRestore(ring, escrow);
  check('restored via header keyName', dec.decode(fast.payload) === HMEMORIES);
  console.log(`   first line: ${dec.decode(fast.payload).split('\n')[0]}`);

  H1('3. Escrow header destroyed → cycle-path restore (name sweep)');
  console.log(`   $ soulvault recovery restore --agent atlas --scan`);
  const bodyOnly = bodyOf(escrow);
  const cycled = await cycleRestore(ring, 'atlas', bodyOnly);
  check('recovered by sweeping epoch names (GCM auth)', dec.decode(cycled.payload) === HMEMORIES);
  console.log(`   sweep found epoch ${cycled.epoch} — no false positives possible, no server round-trips`);

  H1('4. Kick a rogue member + rotate → sweep re-escrows surviving memories');
  console.log(`   $ wallet-cli ring remove --member rogue  &&  soulvault recovery sweep --from-agent rogue`);
  ring.enroll('rogue');
  ring.remove('rogue');
  console.log('   rogue removed: credential now fails trustchain restore (can derive nothing)');
  ring.rotate();
  console.log(`   trustchain rotated → generation ${ring.generation}`);
  let postKick = null;
  try {
    postKick = (await fastRestore(ring, escrow)).payload;
  } catch {
    /* expected: pre-rotation ciphertext is dead after rotation */
  }
  check('pre-rotation escrow NOT decryptable under new generation', postKick === null);
  const legacy = ring.preRotationRing();
  legacy.enroll('atlas-v2'); // sweep operator holds pre-rotation capability
  const swept = await fastRestore(legacy, escrow);
  const newEscrow = await writeEscrow(ring, 'atlas', 3, swept.payload);
  const recheck = await fastRestore(ring, newEscrow);
  check('sweep re-escrowed and verified post-rotation', dec.decode(recheck.payload) === HMEMORIES);

  H1(`Demo complete — ${ok}/4 checks passed`);
  console.log('   Stored permanently: key NAMES only. Zero key bytes at rest.');
  console.log('   Recovery requires: one enrollment tap. Nothing else.');
  process.exit(ok === 4 ? 0 : 1);
})().catch((e) => {
  console.error('DEMO FAILED:', e);
  process.exit(1);
});
