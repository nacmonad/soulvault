#!/usr/bin/env node
/**
 * IRL demo — real Ledger Key Ring (wallet-cli) driving the SoulVault escrow flow.
 *
 * Prerequisites:
 *   1. Ledger device connected + unlocked (Ethereum app NOT required for ring ops)
 *   2. Ledger Sync signed in (trustchain pairing — one-time)
 *   3. wallet-cli installed:   npm i -g @ledgerhq/wallet-cli
 *
 * Run:
 *   node irl-demo.mjs               # full flow incl. one-time `ring init`
 *   node irl-demo.mjs --skip-init   # machine already enrolled
 *
 * Everything is real LKRP here — no LocalDevRing. The only "simulated" parts:
 *   - the escrow framing (plaintext header around the ring-encrypted payload)
 *   - the "die" step, which is just deleting local files
 * Storage is local files; 0G upload is deliberately out (presentation scope).
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const WORK = join(process.cwd(), 'irl-demo-work');
const STORAGE = join(WORK, 'storage'); // stands in for 0G
const SKIP_INIT = process.argv.includes('--skip-init');

// ENS-scoped agent identity (ensv2 subname) → key naming per spec §3
const AGENT_ENS = 'charlie.ops.soulvault-ensv2.eth';
const EPOCH = 3;
const KEY_NAME = `soulvault:epoch-recovery:${AGENT_ENS}:epoch-${String(EPOCH).padStart(6, '0')}`;

const MEMORIES = `# Charlie — harness memory (epoch ${EPOCH})
- Learned: swarm quorum flow uses MemberFileMappingUpdated events
- Context: ETHOnline 2026 Ledger Key Ring integration
- Proof: every encrypt/decrypt below ran through real wallet-cli + LKRP
`;

const H1 = (t) => console.log(`\n━━━ ${t} ━━━`);
const say = (s) => console.log('   ' + s);

/** Run a shell command, echoing it first (the "what command am I watching" log). */
function run(cmd, opts = {}) {
  say(`$ ${cmd}`);
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    if (out && out.trim()) console.log(out.trim().split('\n').map((l) => '     │ ' + l).join('\n'));
    return out;
  } catch (e) {
    if (opts.allowFail) {
      say(`(non-fatal: ${String(e.stderr || e.message).trim().split('\n')[0]})`);
      return null;
    }
    console.error('\n   ✗ command failed. Check exact flags with:');
    console.error('     wallet-cli ring --help && wallet-cli ring encrypt --help');
    console.error(String(e.stderr || e.message));
    process.exit(1);
  }
}

// ── 0. Preflight ─────────────────────────────────────────────
H1('0. Preflight');
run('wallet-cli --version || npx @ledgerhq/wallet-cli --version');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(STORAGE, { recursive: true });

// ── 1. One-time enrollment (THE Ledger tap) ──────────────────
H1('1. Enrollment — the only step that needs the device');
if (SKIP_INIT) {
  say('(skipped: --skip-init — using existing ring membership)');
} else {
  run('wallet-cli ring init'); // device approval + Ledger Sync pairing happens here
}
run('wallet-cli ring keys', { allowFail: true });

// ── 2. Escrow: harness memories → ring-encrypted payload ─────
H1('2. soulvault recovery escrow (real ring encryption underneath)');
const payloadPath = join(WORK, 'memories.md');
writeFileSync(payloadPath, MEMORIES);
say(`$ soulvault recovery escrow --agent ${AGENT_ENS} --epoch ${EPOCH} --archive memories.md`);
run(`wallet-cli ring encrypt --key "${KEY_NAME}" --input "${payloadPath}" --output "${WORK}/payload.enc"`);
// escrow framing is SoulVault's: plaintext header + ring-encrypted body → "storage"
const header = {
  v: 1,
  kind: 'soulvault-epoch-escrow',
  agentId: AGENT_ENS,
  epoch: EPOCH,
  keyName: KEY_NAME,
  alg: 'LKRP/AES-256-GCM via wallet-cli',
  createdAt: new Date().toISOString(),
};
writeFileSync(join(STORAGE, 'escrow.header.json'), JSON.stringify(header, null, 2));
copyFileSync(join(WORK, 'payload.enc'), join(STORAGE, 'escrow.body.enc'));
say('escrow published to storage/: header (plaintext) + body (wallet-cli-encrypted)');

// ── 3. "Die": agent's local state gone ───────────────────────
H1('3. Agent dies — wipe every local copy');
rmSync(payloadPath);
rmSync(join(WORK, 'payload.enc'));
say('local plaintext + working payload deleted. Surviving: storage/ + the ring.');

// ── 4. Fast-path restore on a fresh instance ─────────────────
H1('4. Fresh instance → read header → wallet-cli ring decrypt');
say(`$ soulvault recovery restore --agent ${AGENT_ENS} --epoch ${EPOCH}`);
const header2 = JSON.parse(readFileSync(join(STORAGE, 'escrow.header.json'), 'utf8'));
say(`header says keyName = ${header2.keyName}`);
run(`wallet-cli ring decrypt --key "${header2.keyName}" --input "${join(STORAGE, 'escrow.body.enc')}" --output "${join(WORK, 'restored.md')}"`);
const restored = readFileSync(join(WORK, 'restored.md'), 'utf8');
if (restored === MEMORIES) {
  say('✅ restored byte-identical via REAL LKRP derivation — zero stored key material');
} else {
  say('❌ restored content mismatch'); process.exit(1);
}

console.log('\n━━━ Done — artifacts in irl-demo-work/ ━━━');
console.log('   Stored permanently: key NAMES only. Zero key bytes at rest.');
console.log('   Enrollment: one Ledger tap. Restore: no device, just trustchain + network.');
