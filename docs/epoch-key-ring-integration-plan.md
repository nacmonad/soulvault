# Epoch Key Ring — Integration Plan

**Status:** implementable tonight (submission due 2026-09-13) · **reassessed against main @ b985147**
**Companion docs:** `docs/epoch-key-ring-spec.md`, `examples/epoch-key-ring-demo/`
**Branch:** `feature/epoch-key-ring` (merged origin/main — UI + CLI state current)

## 0. The story this tells

SoulVault agents get durable identity (ENSv2 subnames via ERC-8004) and durable
memories (epoch escrows). The Ledger Key Ring supplies the missing piece —
**key custody that survives agent death without storing any key material**:

- ENSv2 subname (`charlie.ops.soulvault-ensv2.eth`) = *who the agent is*, resolvable across re-deploys
- Ledger Key Ring (LKRP) = *how epoch keys are derived*, never stored
- SoulVaultSwarm contract = *what the swarm authorizes*, announced in events
- Manifest pointer = *where the ciphertext lives* (pluggable locator)

Pitch line: **"The contract never sees a key — it sees events. Kick events
trigger sweeps, manifests point at escrows, ENS anchors identity. All crypto
lives in the Ledger Key Ring; SoulVault adds naming and choreography."**

## 0.5 What main already has (scan results — this changes the plan)

- **`soulvault epoch` command group exists** (`apps/cli/src/commands/epoch.ts`):
  `rotate --swarm`, `show-bundle`, `decrypt-bundle-member` — backed by
  `packages/node/src/epoch-bundle.ts` (wrap/rotate/decrypt via secp256k1
  wrapped-key bundles) and **`epoch-key-store.ts`, which persists raw
  `keyHex` per (swarm, epoch)**. That keystore *is* the physical-historic-key
  liability from the original problem statement. The ring makes it obsolete:
  **derive, don't store.**
- **`swarm remove`** exists (`--yes --reason`) → already emits
  `MemberRemoved(member, by, currentEpoch)` and bumps `membershipVersion`.
- **Swarm page** (`apps/web/src/app/dashboard/swarm/page.tsx`, 479 lines)
  already renders Epoch, Membership version, Members with per-member action
  buttons, and consumes live events via `hooks/useSwarmEvents.ts`.
- **CLI registration** is a one-liner pattern in `apps/cli/src/index.ts`
  (`register*Commands(program)` × 14 existing groups).

## 1. What needs NO contract changes (the core loop)

### 1.1 Kick trigger — already shipped

`MemberRemoved` event is the sweep trigger. Trustchain (Ledger) enforces
revocation; the contract only announces membership facts.

### 1.2 Escrow discovery — reuse manifest machinery

`MemberFileMappingUpdated` + `_agentManifests` (ManifestPointer:
`storageLocator, merkleRoot, publishTxHash, manifestHash, epoch`) are already
how harness memories achieve swarm visibility. Escrows reuse the same pattern:
escrow publish → manifest update → fresh instance resolves
ENS subname → agent address → manifest → fetch → ring decrypt.

### 1.3 Key derivation — pure LKRP/offchain

Key names `soulvault:epoch-recovery:<agent-ens>:epoch-<n>`; zero key bytes on
chain, in metadata, or at rest. Invariant: keep it.

## 2. Implementation phases (tonight-sized, revised for main)

### Phase 1 — Recovery CLI + ring-backed epoch keys (~2–3h)

**New files** (keep existing epoch.ts/keystore untouched for compat):

- `packages/node/src/recovery-escrow.ts` — escrow v0 format per spec §4
  (plaintext header + ring-encrypted body), fast/cycle/sweep functions
- `packages/node/src/ring-backend.ts` — `RingBackend` seam:
  - `LedgerRingBackend` — shells to `wallet-cli ring encrypt/decrypt`
  - `LocalDevRingBackend` — HKDF + AES-GCM simulation (demo/test mode),
    ported from `examples/epoch-key-ring-demo/demo.mjs`
- `apps/cli/src/commands/recovery.ts` — command group, registered in
  `index.ts` alongside the other 14:
  - `soulvault recovery escrow --agent <ens> --epoch <n> --archive <file>`
  - `soulvault recovery restore --agent <ens> [--epoch <n> | --scan]`
  - `soulvault recovery sweep --agent <ens>` (decrypt under pre-rotation
    derivation → re-encrypt post-rotation → republish + manifest update)
  - `--backend ledger|local` flag; `local` default until hardware enrolled

**Bridge to the existing epoch flow:** `epoch rotate` gains an optional
`--ring` flag that derives the new epoch key via the ring instead of calling
`generateEpochKeyHex()`/`storeEpochKey()`. Existing stored-key behavior stays
default tonight (don't break the redaction/rehydrate demo); the flag is the
migration path and the demo-visible difference.

### Phase 2 — Swarm page UI: "Sweep Epoch" (~1–1.5h)

Surface recovery on the existing Swarm page (no new routes):

- **Member row action:** a `Sweep` button on each member row (same row pattern
  as existing action buttons) → calls `recovery sweep` semantics → shows
  progress/result inline. Primary demo beat for the recording.
- **Fields:** extend the existing `<dl>` grid (Epoch / Membership version /
  Treasury / Members) with **Escrow** (latest epoch escrow locator or "—") and
  **Last sweep** (from `EpochSweepCompleted` event, if Phase 3 lands; else from
  local state).
- **Events:** extend `useSwarmEvents` kinds to include `MemberRemoved` →
  surface a "sweep recommended" hint on affected member rows. This makes the
  UI tell the story: kick → hint → sweep → hint clears.
- Data source: CLI child-process or direct `@soulvault/node` import (page
  already imports from workspace packages — follow existing pattern in
  `components/dashboard/agent-identity-card.tsx` consumers).

### Phase 3 — Optional contract addition (~30 min)

Event-only attestation, no state, matches existing withSig owner pattern:

```solidity
event EpochSweepCompleted(
    address indexed agent,
    uint64  fromEpoch,
    uint64  toEpoch,
    bytes32 newEscrowRoot,
    address indexed by
);

function completeSweep(address agent, uint64 fromEpoch, uint64 toEpoch,
                        bytes32 newEscrowRoot) external onlyOwner whenNotPaused;
```

"Owner signs the irreversible thing" — the Ledger-track beat. Skippable; the
demo does not depend on it.

### Phase 4.5 — Catastrophic recovery flow (the ENSv2 × Key Ring payoff)

Full-loss scenario: Charlie loses wallet keypair, memories, and instance.
As org owner:
1. Generate new wallet for the fresh instance.
2. Re-point the subname: `setSubnodeRecord(node, charlie-label, newOwner,
   resolver, ttl)` — ABI already in `packages/node/src/ens.ts`. ERC-8004
   registration re-points to the new address too.
3. `swarm remove <old-address>` → `MemberRemoved` → sweep trigger fires.
4. New instance: `ring init` (one Ledger tap) → `swarm join-request` → owner
   approves → `recovery restore --agent charlie.ops...` → memories back.

**The name carried the identity; the ring carried the keys; nothing was ever
stored to lose.** Lost keypair ≠ lost memories — the slide that kills every
keystore-based competitor.

### Phase 5 — Submission assets (~1h)

- simulated demo video (done, v4, 5/5 checks)
- IRL recording at home (`examples/epoch-key-ring-demo/irl-demo.mjs` + README)
- Swarm page sweep recording (Phase 2 output)
- this doc + spec as the "how it fits" pages

## 3. Trust model (one paragraph for the writeup)

Revocation is forward-looking only: a kicked member keeps past ciphertexts but
loses derivation capability at the trustchain service, so every member removal
MUST trigger a re-escrow sweep. Non-member recovery is an enrollment handoff:
a new instance enrolls from the owner's seed/device and inherits membership,
not historic keys. The cycle path (header loss) works because AAD is bound
only to guessable fields (`kind`, `agentId`) and GCM authentication rejects
wrong-epoch guesses.

## 4. What we are NOT doing tonight

- No replacement of `epoch-key-store.ts` behavior (stored-key path stays for
  the existing demo; `--ring` flag is the visible migration)
- No redaction/rehydrate pipeline changes (per Scott's directive)
- No LKRP SDK deep integration (wallet-cli binary is the seam; cycle-path on
  real hardware waits for Ledger to expose derivation)
- No 0G coupling beyond the existing locator abstraction
- No changes to `packages/protocol` wire formats (epoch escrows are a new
  artifact, not a new wire format — no version bump)
