# Epoch Key Ring — Integration Plan

**Status:** implementable tonight (submission due 2026-09-13)
**Companion docs:** `docs/epoch-key-ring-spec.md` (crypto/format), `examples/epoch-key-ring-demo/`
**Branch:** `feature/epoch-key-ring`

## 0. The story this tells

SoulVault agents get durable identity (ENSv2 subnames via ERC-8004) and durable
memories (epoch escrows). The Ledger Key Ring supplies the missing piece —
**key custody that survives agent death without storing any key material**:

- ENSv2 subname (`charlie.ops.soulvault-ensv2.eth`) = *who the agent is*, resolvable across re-deploys
- Ledger Key Ring (LKRP) = *how the agent's epoch keys are derived*, never stored
- SoulVaultSwarm contract = *what the swarm authorizes*, announced in events
- Escrow manifest pointer = *where the ciphertext lives* (0G today; any locator tomorrow)

One line for the pitch: **"The contract never sees a key — it sees events.
Kick events trigger sweeps, manifests point at escrows, ENS anchors identity.
All crypto lives in the Ledger Key Ring; SoulVault adds naming and choreography."**

## 1. What needs NO contract changes (the core loop)

### 1.1 Kick trigger — already shipped

`SoulVaultSwarm._removeMember()` (`contracts/SoulVaultSwarm.sol:208`) already
emits `MemberRemoved(member, by, currentEpoch)` and bumps `membershipVersion`.
That event **is** the sweep trigger. Revocation enforcement itself lives in
Ledger's trustchain (removed credential can't derive anything); the contract
only announces membership facts.

### 1.2 Escrow discovery — reuse existing manifest machinery

`MemberFileMappingUpdated` events + `_agentManifests` (ManifestPointer:
`storageLocator, merkleRoot, publishTxHash, manifestHash, epoch`) are already
how harness memories achieve swarm visibility. Recovery escrows reuse the exact
same pattern:

```
recovery escrow
  → write escrow (header + GCM body) to storage (0G / local for demo)
  → update agent manifest → MemberFileMappingUpdated(member, epoch, locator, ...)

fresh instance
  → resolve ENS subname → ERC-8004 identity → agent address
  → read manifest pointer → fetch escrow → ring decrypt (fast path)
```

Zero new contracts. ENS = identity anchor, manifest = discovery layer,
ring = key layer.

### 1.3 Key derivation — pure LKRP/offchain

Key names (`soulvault:epoch-recovery:<agent-ens>:epoch-<n>`) are derived via
`wallet-cli ring` / LKRP. No key bytes ever touch the chain, our storage
metadata, or disk at rest. This invariant is the whole security story — keep it.

## 2. Implementation phases (tonight-sized)

### Phase 1 — CLI commands on `packages/node` (~2–3h)

Extend the existing backup/restore surface (see `packages/node/src/backup.ts`,
`restore.ts`, `epoch-bundle.ts`, `epoch-key-store.ts`):

- `soulvault recovery escrow --agent <ens> --epoch <n> --archive <file>`
  - builds escrow v0 (plaintext header + ring-encrypted body) per spec §4
  - encrypts payload via `wallet-cli ring encrypt --key <keyName>` when LKRP is
    available; falls back to HKDF-simulated ring (demo mode, clearly labeled)
  - publishes to storage, updates manifest pointer via existing
    `swarm-contract.ts` mapping update path
- `soulvault recovery restore --agent <ens> [--epoch <n> | --scan]`
  - fast path: read header keyName → derive → decrypt
  - `--scan`: sweep epochs 1..N, GCM auth decides (no server round-trips)
- `soulvault recovery sweep --agent <ens>` (+ `--watch` stretch)
  - detect `MemberRemoved` → decrypt under pre-rotation derivation →
    re-encrypt under post-rotation names → republish + update manifest

**Demo-mode seam:** a `RingBackend` interface with two impls —
`LedgerRingBackend` (shells to `wallet-cli ring`) and `LocalDevRing` (the
simulated one from the demo). Same interface, one flag to switch. This keeps
tonight testable without hardware while making the real path first-class.

### Phase 2 — Optional contract addition (~30 min) — sweep attestation

Nothing onchain currently proves a sweep *happened*. Minimal event-only
addition to `ISoulVaultSwarm.sol` + `SoulVaultSwarm.sol`, no state, no storage:

```solidity
event EpochSweepCompleted(
    address indexed agent,
    uint64  fromEpoch,
    uint64  toEpoch,
    bytes32 newEscrowRoot,   // merkle root of re-escrowed manifest
    address indexed by
);

function completeSweep(address agent, uint64 fromEpoch, uint64 toEpoch,
                        bytes32 newEscrowRoot) external onlyOwner whenNotPaused;
```

Matches our existing withSig owner pattern (`removeMemberWithSig` etc.) if we
want the human-confirmation story: **owner signs the sweep completion — the
"human approves the irreversible thing" beat for the Ledger track.** If time
is short, skip: the demo does not depend on it.

### Phase 3 — Wire into the ENSv2 identity lane (~1h)

Already half-built: `packages/node/src/ens-name.ts`, `ens.ts`,
`identity.ts`, `agent.ts`, plus the ERC-8004 adapter
(`contracts/SoulVaultERC8004RegistryAdapter.sol`). Recovery adds one rule:

- fresh instance boot → resolve own subname → derive epoch key names from
  trustchain → restore latest manifest → pull + decrypt escrow → rehydrate

This is the story beat: **ENS makes identity continuous; the ring makes keys
continuous; the manifest makes ciphertext findable.** Re-deploy = same
subname = same keyNames = same memories.

### Phase 4 — Submission assets (~1h)

- simulated demo video (done, v4)
- IRL recording at home (script ready: `examples/epoch-key-ring-demo/irl-demo.mjs`)
- README section + this doc as the "how it fits" page

## 3. Trust model (one paragraph for the writeup)

Revocation is forward-looking only: a kicked member keeps past ciphertexts but
loses derivation capability at the trustchain service, so every member removal
MUST trigger a re-escrow sweep. Non-member recovery is an enrollment handoff:
a new instance enrolls from the owner's seed/device and inherits membership,
not historic keys — the ring derives whatever the current membership allows.
The cycle path (header loss) works because AAD is bound only to guessable
fields (`kind`, `agentId`) and GCM authentication rejects wrong-epoch guesses.

## 4. What we are NOT doing tonight

- No onchain key material, wrapped-key grants, or slot-level hydration changes
  (redaction/rehydration pipeline untouched, per Scott's directive)
- No LKRP SDK deep integration (wallet-cli binary is the seam for now;
  cycle-path on real hardware waits for Ledger to expose derivation)
- No 0G-specific code paths beyond the existing locator abstraction
  (0G retired as ETHOnline sponsor; storage stays pluggable)
- No changes to `packages/protocol` wire formats (no version bump needed —
  epoch escrows are a new artifact, not a new wire format)
