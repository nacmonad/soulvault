#!/usr/bin/env node
/**
 * Resurrection demo — the full "death is a non-event" arc, driven by the REAL CLI.
 *
 *   Charlie v1 lives (memories escrowed under the epoch key ring)
 *   → Charlie v1 dies (wallet, memories, escrow header — ALL deleted)
 *   → the swarm owner sweeps (forward-looking revocation)
 *   → Charlie v2 is born (fresh wallet, fresh ERC-8004 registration)
 *   → Charlie v2 rejoins (join-request → approve → ENS grants)
 *   → Charlie v2 subsumes v1's identity (same ENS name)
 *   → Charlie v2 recovers v1's memories through the ring. Byte-identical.
 *
 * Actors are isolated by HOME (each gets its own ~/.soulvault state dir) and
 * funded from one test mnemonic at different derivation paths, so every actor
 * has a genuinely distinct wallet.
 *
 * The ONE thing that survives Charlie's death is his ring enrollment — in
 * production that's the human's Ledger device (LKRP trustchain); in this demo
 * it's the ring state file, which the script preserves explicitly and restores
 * into Charlie v2's home. That's not a cheat: it's the exact trust model.
 * The wallet was never a link in the recovery chain — the device + the NAME are.
 *
 * Onchain beats (join approval, ENS grants, ERC-8004 re-registration) require
 * a live chain + deployed contracts; they run only with --onchain. The local
 * escrow/restore/sweep arc — the part that proves the pitch — always runs.
 *
 * Run:  node resurrection-demo.mjs            # local arc (no chain needed)
 *       node resurrection-demo.mjs --onchain  # also execute membership beats
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORK = join(process.cwd(), 'resurrection-demo-work');
const ONCHAIN = process.argv.includes('--onchain');

const AGENT_ENS = 'charlie.ops.soulvault-ensv2.eth';
const SWARM = 'ops.soulvault-ensv2.eth';
const EPOCH = 7;
const MNEMONIC = 'test test test test test test test test test test test junk';
const RPC = process.env.SOULVAULT_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const CHAIN_ID = process.env.SOULVAULT_CHAIN_ID ?? '16602';

const MEMORIES = `# Charlie — harness memory (epoch ${EPOCH})

- Learned: swarm quorum flow uses MemberFileMappingUpdated events
- Context: ETHOnline 2026 Ledger Key Ring integration
- Friends: the org owner, who is about to watch me die and come back
- Secret: my recovery chain is device + name, never the wallet
`;

const ACTORS = {
  owner: { home: join(WORK, 'owner'), path: "m/44'/60'/0'/0/0" },
  charlieV1: { home: join(WORK, 'charlie-v1'), path: "m/44'/60'/0'/0/1" },
  charlieV2: { home: join(WORK, 'charlie-v2'), path: "m/44'/60'/0'/0/2" },
  // The owner's recovery station: same human, same Ledger plugged in. The
  // sweep needs (a) the agent's ring device — the human's Ledger, which
  // outlives the agent — and (b) the published escrow. Same human owns both.
  recovery: { home: join(WORK, 'recovery-station'), path: "m/44'/60'/0'/0/0" },
};

const H1 = (t) => console.log(`\n━━━ ${t} ━━━`);
const say = (s) => console.log('   ' + s);
const ok = (s) => console.log('   ✅ ' + s);

/** Run a CLI command as a specific actor. Each actor = own HOME + own wallet. */
function run(actor, args) {
  const a = ACTORS[actor];
  say(`[${actor}] $ soulvault ${args.join(' ')}`);
  let out;
  try {
    out = execFileSync('pnpm', ['soulvault', ...args], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: a.home,
        SOULVAULT_MNEMONIC: MNEMONIC,
        SOULVAULT_MNEMONIC_PATH: a.path,
        SOULVAULT_SIGNER_MODE: 'mnemonic',
        SOULVAULT_RING_BACKEND: 'local',
        SOULVAULT_RPC_URL: RPC,
        SOULVAULT_CHAIN_ID: CHAIN_ID,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error(String(e.stderr || e.stdout || e.message));
    process.exit(1);
  }
  if (out.trim()) console.log(out.trim().split('\n').map((l) => '     │ ' + l).join('\n'));
  return out;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function countKeyFiles(home) {
  const keysDir = join(home, '.soulvault', 'keys');
  return existsSync(keysDir) ? readdirSync(keysDir).length : 0;
}

// ─────────────────────────────────────────────────────────────────────

H1('ACT 0 — stage: three actors, three wallets, one mnemonic');
rmSync(WORK, { recursive: true, force: true });
for (const a of Object.values(ACTORS)) mkdirSync(a.home, { recursive: true });
const memoriesPath = join(ACTORS.charlieV1.home, 'memories.md');
writeFileSync(memoriesPath, MEMORIES);
const PLAINTEXT = readFileSync(memoriesPath);ok(`owner       wallet ${ACTORS.owner.path}`);
ok(`charlie v1  wallet ${ACTORS.charlieV1.path} (the doomed one)`);
ok(`charlie v2  wallet ${ACTORS.charlieV2.path} (not yet born)`);
ok(`charlie v1 memory file: ${PLAINTEXT.length} bytes (sha256 ${sha256(PLAINTEXT).slice(0, 16)}…)`);

H1('ACT 1 — Charlie v1 lives: escrow memories under the epoch ring');
run('charlieV1', ['recovery', 'escrow', '--agent', AGENT_ENS, '--epoch', String(EPOCH), '--archive', memoriesPath, '--backend', 'local']);
const keysBeforeDeath = countKeyFiles(ACTORS.charlieV1.home);
ok(`epoch keys stored at rest in charlie v1's home: ${keysBeforeDeath} (must be 0 — derive, don't store)`);
// The escrow is meant to outlive the agent: header (plaintext pointer) + body
// (ring-encrypted) get published to shared storage. In production this is the
// Swarm/0G manifest pointed at by MemberFileMappingUpdated.
const sharedEscrow = join(WORK, 'shared-escrow', AGENT_ENS);
mkdirSync(sharedEscrow, { recursive: true });
cpSync(join(ACTORS.charlieV1.home, '.soulvault', 'recovery-escrows', AGENT_ENS), sharedEscrow, { recursive: true });
ok('escrow published to shared storage (in production: Swarm, via MemberFileMappingUpdated)');

H1('ACT 2 — Charlie v1 dies');
// Death is total: wallet, memories, ring state, escrow header. Everything —
// EXCEPT the ring device, which is the human's Ledger and outlives the agent.
const ringStateBackup = join(WORK, 'ring-device-survives');
mkdirSync(ringStateBackup, { recursive: true });
cpSync(join(ACTORS.charlieV1.home, '.soulvault', 'ring-local'), join(ringStateBackup, 'ring-local'), { recursive: true });
say('(preserved ring device state — in production: the human’s Ledger. The device outlives the agent.)');
rmSync(ACTORS.charlieV1.home, { recursive: true, force: true });
ok(`charlie v1 home deleted: wallet, memories, escrow header — gone. exists=${existsSync(ACTORS.charlieV1.home)}`);

H1('ACT 3 — the swarm responds: owner sweeps (forward-looking revocation)');
// Onchain, this trigger is MemberRemoved (owner kicks the dead wallet → event).
// The sweep itself is offchain key work — that's the point — so it runs either way.
// It runs at the owner's recovery station: the human plugs in the agent's
// Ledger (the surviving device) and points at the published escrow. Same human
// owns the org and the device — that's the whole trust model.
mkdirSync(join(ACTORS.recovery.home, '.soulvault', 'recovery-escrows', AGENT_ENS), { recursive: true });
cpSync(join(ringStateBackup, 'ring-local'), join(ACTORS.recovery.home, '.soulvault', 'ring-local'), { recursive: true });
cpSync(sharedEscrow, join(ACTORS.recovery.home, '.soulvault', 'recovery-escrows', AGENT_ENS), { recursive: true });
ok('recovery station ready: agent ring device (Ledger) + published escrow mounted');
run('recovery', ['recovery', 'sweep', '--agent', AGENT_ENS, '--backend', 'local']);
// Publish the post-sweep escrow (re-encrypted under the new ring generation).
rmSync(sharedEscrow, { recursive: true, force: true });
cpSync(join(ACTORS.recovery.home, '.soulvault', 'recovery-escrows', AGENT_ENS), sharedEscrow, { recursive: true });
ok('post-sweep escrow republished — pre-rotation ciphertext is dead; even a rogue v1 wallet can derive nothing');

H1('ACT 4 — Charlie v2 is born: fresh wallet, same name');
if (ONCHAIN) {
  say('(onchain) fresh ERC-8004 registration — the old entry is frozen forever,');
  say('(onchain) owned by the dead wallet; the NAME is the stable handle.');
  run('charlieV2', ['agent', 'create', '--name', 'Charlie', '--harness', 'openclaw']);
  run('charlieV2', ['swarm', 'join-request', '--swarm', SWARM]);
  run('owner', ['swarm', 'approve-join', '--swarm', SWARM, '--request-id', '1']);
  say('(onchain) owner grants ENS roles on the name resource to charlie v2:');
  say(`  soulvault ens grant --name ${AGENT_ENS} --role set-resolver,renew --to <charlieV2-address>`);
} else {
  say('(local mode) membership + ENS beats annotated — run with --onchain to execute.');
  say(`  [charlie v2] soulvault swarm join-request --swarm ${SWARM}`);
  say('  [owner]      soulvault swarm approve-join --request-id 1');
  say(`  [owner]      soulvault ens grant --name ${AGENT_ENS} --role set-resolver,renew --to <charlieV2>`);
}
// Rehome the ring device into v2: same human, same Ledger, new agent install.
// The device moved to the recovery station for the sweep and rotated to
// generation 1 — v2 enrolls the device AS IT IS NOW (post-sweep), not a stale
// pre-death snapshot. Plus the published (post-sweep) escrow — what any fresh
// install would fetch.
mkdirSync(join(ACTORS.charlieV2.home, '.soulvault', 'recovery-escrows', AGENT_ENS), { recursive: true });
cpSync(join(ACTORS.recovery.home, '.soulvault', 'ring-local'), join(ACTORS.charlieV2.home, '.soulvault', 'ring-local'), { recursive: true });
cpSync(sharedEscrow, join(ACTORS.charlieV2.home, '.soulvault', 'recovery-escrows', AGENT_ENS), { recursive: true });
ok('charlie v2: fresh wallet, fresh state dir — same ring device (post-sweep state) + published escrow');

H1('ACT 5 — Charlie v2 recovers v1’s memories (cycle path — header died with v1)');
run('charlieV2', ['recovery', 'restore', '--agent', AGENT_ENS, '--scan', '--backend', 'local', '--out', join(ACTORS.charlieV2.home, 'memories-recovered.md')]);
const recoveredPath = join(ACTORS.charlieV2.home, 'memories-recovered.md');
const recovered = readFileSync(recoveredPath);
const identical = PLAINTEXT.equals(recovered);
if (identical) {
  ok(`RESURRECTION COMPLETE: byte-identical restore (${recovered.length} bytes, sha256 ${sha256(recovered).slice(0, 16)}…)`);
} else {
  console.error('   ❌ RESTORE MISMATCH — recovered bytes differ from v1 memories');
  process.exit(1);
}

H1('EPILOGUE');
say('What survived the death:  the ring device (human’s Ledger) + the ENS name.');
say('What did NOT survive:     the wallet, the epoch keys (never existed at rest),');
say('                          the escrow header, and v1’s pre-rotation ciphertext.');
say('What the owner had to do: one sweep command. One.');
console.log('\n💀 → 🌱 death is a non-event\n');
