# Epoch Key Ring: harness-memory recovery spec

**Status:** Draft v0.1 — 2026-09-12
**Branch:** `feature/epoch-key-ring`
**Scope:** Recovery of harness memories for ephemeral / newly-deployed agents. Does NOT touch the slot/recipient grant pipeline, redaction, rehydration flows, or 0G publication.

## 1. Problem

The current recovery design stores `K_epoch` as a physical secret (env var / config,
`SOULVAULT_TEST_K_EPOCH`, with `TEST_K_EPOCH_HEX` fallback). Intended choreography was:
dwarm members custodian historic epoch keys, an ephemeral agent asks a member to help
recover its harness memories.

Failure modes:

- Historic keys must be physically stored somewhere — by every custodian.
- Any custodian losing them = memories permanently unrecoverable.
- Custodianship spreads the plaintext-adjacent secret to every member; a kicked member
  likely still holds copies.
- Ephemeral agents have no persistent state, so they cannot self-custody at all.

## 2. Solution shape: derive, don't store

Replace stored `K_epoch` values with **ring-derived epoch keys**, using the Ledger
Key Ring Protocol (LKRP) via `wallet-cli ring`:

- Enrollment: a machine (agent runtime) is enrolled into the Key Ring once, with a
  Ledger device approving the enrollment. After enrollment, encrypt/decrypt need only
  network access to the trustchain service + the local member credential — no device,
  no USB. This is what makes VPS / hosted-agent recovery possible.
- Derivation: an encryption key is never stored under a name. It is HKDF-derived from
  trustchain material with the key *name* as domain separation. Same name + same
  trustchain state ⇒ same 256-bit key, on any enrolled machine.
- Consequence: `K_epoch` stops being a secret at rest and becomes
  `derive("soulvault:epoch-recovery:<agentId>:epoch-<n>")`. Nothing to lose, nothing
  for custodians to hold.

## 3. Key naming (canonical)

```
soulvault:epoch-recovery:<agentId>:epoch-<n>
```

- `agentId`: stable agent identity (ENS name, swarm member id, or address).
- `epoch-<n>`: monotonically increasing backup epoch for that agent, zero-padded
  (`epoch-000003`) so lexicographic and numeric order agree.
- The name is the ONLY durable metadata required for recovery. It is not secret
  (it can appear in plaintext headers and logs).

## 4. Escrow format (v0)

A recovery escrow packages one agent's harness-memory archive for ring-encrypted
storage. Any storage backend works; 0G is deferred (demo uses local files).

```
+-----------------------------------------------+
| plaintext header (JSON, UTF-8)                |
| {                                             |
|   "v": 1,                                     |
|   "kind": "soulvault-epoch-escrow",           |
|   "agentId": "atlas",                         |
|   "epoch": 3,                                 |
|   "keyName": "soulvault:epoch-recovery:...",  |
|   "alg": "AES-256-GCM",                       |
|   "createdAt": "2026-09-12T..."               |
| }                                             |
+-----------------------------------------------+
| 12-byte IV                                    |
+-----------------------------------------------+
| AES-256-GCM ciphertext + 16-byte auth tag     |
+-----------------------------------------------+
```

- Header is plaintext by design: normal recovery needs no key search.
- Payload: the harness-memory archive (demo: a markdown file) encrypted with the
  derived epoch key. AAD binds the header, so headers cannot be swapped between
  escrows.

## 5. Recovery flows

### 5.1 Fast path (header intact)

1. New agent instance enrolls into the ring (one Ledger tap at deploy time — this is
   the entire "owner review": enrollment, not per-request).
2. Read escrow header → get `keyName`.
3. Derive key, decrypt, rehydrate. No cycling, no network search beyond the
   trustchain restore.

### 5.2 Cycle path (header lost/corrupted)

Key derivation is local and free; AES-GCM authentication makes wrong keys fail
cleanly. So:

1. Enumerate candidate names `epoch-1..epoch-max` for the agentId.
2. Derive each, attempt decrypt; exactly one authenticates.
3. `epoch-max` can be bounded by the swarm's published epoch watermark or a
   conservative scan ceiling (e.g. current epoch + 64).

No false positives are possible: GCM auth failure on every wrong candidate.

### 5.3 Non-member recovery

The ring is member-scoped, so "non-member recovery" is achieved by making
**enrollment the recovery handoff**: the new instance is not a dwarm member and does
not need to be; it enrolls into the ring from the same owner seed/device and inherits
derivation rights. Replaces "members hold historic keys" entirely.

## 6. Revocation / rotation (kick semantics)

- Removal is enforced at the trustchain: a removed member's credential fails at the
  restore step and can derive nothing further.
- Revocation is forward-looking only: plaintext already recovered by the kicked agent
  cannot be un-recovered.
- Rotation collateral: after a trustchain rotation, pre-rotation ciphertext may no
  longer decrypt from the new derivation state. Therefore **every member removal MUST
  trigger a re-escrow sweep**: a still-valid member decrypts all active escrows and
  republishes them under post-rotation key names
  (`soulvault:epoch-recovery:<agentId>:epoch-<n>` derived in the new trustchain
  generation, or a `gen-<g>` segment appended post-rotation).
- The sweep is the same key-rotation choreography the dwarm design already had —
  only the custodian changes (ring instead of member env files).

## 7. Ledger integration mapping

| Demo (v0)                    | Production                                          |
| ---------------------------- | --------------------------------------------------- |
| LocalDevRing (simulated LKRP)| `wallet-cli ring init` enrollment w/ Ledger device  |
| HKDF from in-memory seed     | HKDF from trustchain-restored material              |
| File-based escrows           | 0G-stored escrows alongside backup bundles          |
| Local member removal         | Trustchain member removal + rotation via LKRP       |

Production CLI surface (target):

```
soulvault recovery escrow  --agent <id> --epoch <n> --archive <path>   # create + encrypt
soulvault recovery restore --agent <id> [--epoch <n>] [--scan]         # fast path / cycle path
soulvault recovery sweep   --from-agent <removed-id>                   # post-rotation re-escrow
```

## 8. Demo (this branch)

`examples/epoch-key-ring-demo/` — zero-dependency Node script. No 0G, no contracts,
no hardware. Simulates the ring semantics locally and demonstrates:

1. Agent backs up a markdown harness-memory file at epoch 3 → escrow written.
2. Agent "dies". Fresh instance, zero local state, enrolls → fast-path restore.
3. Escrow header destroyed → cycle-path restore sweeps epoch names until GCM
   authentication succeeds.
4. Member removal + rotation → removed member can no longer derive; sweep re-escrows
   surviving memories for the remaining agents.

Run: `node examples/epoch-key-ring-demo/demo.mjs`

## 9. Non-goals (explicit)

- No changes to slot/recipient grants, redaction, or browser rehydration.
- No 0G upload in this phase (escrow format is backend-agnostic).
- No browser-facing Key Ring API (LKRP has none today; headless lane only).
- Per-request owner approval is out of scope; gating is enrollment-time only.
