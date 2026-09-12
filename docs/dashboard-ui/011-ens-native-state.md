# ENS-native state: eliminate `~/.soulvault` as a data layer

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## Problem

Protocol state is split across two homes with different trust properties:

1. **ENS on Sepolia** — public, permissionless, readable by any wallet or
   browser without our stack (ENSIP-11 addr slots, `class`/`name`,
   `soulvault.swarms`, `soulvault.treasuries`, swarm subdomain records).
2. **`~/.soulvault/*.json` profiles** — private to one machine, invisible to
   the dashboard, stale the moment another actor writes on-chain.

The dashboard still leans on `NEXT_PUBLIC_SOULVULT_DEPLOYMENTS` (a build-time
env var) and the CLI on local profiles for facts that ENS already carries or
could carry. Every actor that discovers entities through ENS while another
keeps state in dotfiles guarantees drift.

## Vision

**ENS on the identity lane is the canonical state layer for all non-secret
protocol metadata.** `~/.soulvault` shrinks to two things:

- `keys/` — K_epoch material and secrets. Never leaves the machine, never
  touches ENS (everything there is public by construction).
- UI preference state (active org/swarm selection, RPC override) — that is
  *UX* state, not protocol state. Browser: localStorage. CLI: one tiny
  pointer file. Not data — just "what am I looking at right now".

Everything else — orgs, treasuries, swarms, agent identity — is discoverable
from a wallet address or an ENS name by any web3-native client.

## State inventory and fate

| Today in `~/.soulvault` | Canonical home | Status |
|---|---|---|
| `organizations/<slug>.json` (slug, ensName) | The ENS name itself + `class`/`name` text records; ownership = `registry.owner(orgNode)` | **Landed** (`register-ens`) |
| `treasuries/<orgSlug>.json` (address, chainId, owner, ensBinding) | ENSIP-11 `addr(orgNode, coinType)` + `soulvault.treasuries` enumeration record | **Landed** (`treasury create/bind` + wizard); missing `deployedAtBlock` → 012 |
| `swarms/<slug>.json` (contractAddress, chainId, label) | Swarm subdomain: `soulvault.swarmContract` + `soulvault.chainId` + `addr`; org list in `soulvault.swarms` CBOR record; treasury binding readable on-chain via `swarm.treasury()` | **Mostly landed**; missing `deployedAtBlock` + visibility → 012 |
| `agent.json` (wallet, ERC-8004 registry/id) | ERC-8004 registry on Sepolia + agent ENS subdomain (`rusty.ops.acme.eth` convention) | Partial; profile fields → future text records |
| `keys/`, `last-backup.json` | **Stays local.** Encrypted artifacts live on 0G Storage with on-chain proofs; plaintext keys never leave the device | Non-goal — do not migrate |
| `state.ts` active-org/active-swarm pointer | UX preference, not protocol state | Keep local (localStorage for web) |

## Design principles

1. **Public-only.** ENS text records are world-readable and permanent-ish.
   Nothing secret, nothing per-user-private, ever goes in. Stealth/private
   swarms already skip ENS binding by design — ENS-native reads must degrade
   gracefully (no records = not listed), never break them.
2. **The `addr` slot is truth; text records are indexes.** Where a record and
   its ENSIP-11 slot disagree, resolution wins and the UI flags corruption.
3. **Upsert-by-key, read-modify-write the whole record.** ERC-634 has no key
   enumeration, so single known keys (`soulvault.treasuries`,
   `soulvault.swarms`) carry enumerated JSON/CBOR payloads. Writers must merge
   against the current on-chain value, never blind-overwrite.
4. **Format parity is a compat contract.** CLI and browser writers/reading
   helpers must encode/decode identically (see the CBOR parity note in
   `apps/web/src/lib/ens-writes.ts`). Cross-checked by tests on both sides.
5. **Writes are transactions.** Batch them (resolver `multicall`, ticket 013)
   and keep the record small. Records are for slow-changing discovery data,
   not telemetry.
6. **Local files become caches.** CLI reads go ENS-first with local cache as
   fallback for offline (ticket 014); the browser never needs CLI state files.

## Non-goals

- Moving keys, epoch bundles, or backups onto ENS.
- Historical/audit log on ENS — text records overwrite silently; event
  history stays with the contracts (that's what `swarm events` is for).
- Renaming the ops lane or changing ENSIP-11 semantics.

## Migration

Existing deployments backfill in one command each once 012 lands
(`treasury bind --address … --force` re-writes the enumeration record with
`deployedAtBlock`; swarm re-bind or a dedicated `swarm backfill-ens` does the
subdomain records). No hard cutover: env-var deployments remain a fallback
until ENS bootstrap is verified in the dashboard.

## Children

- [012-ens-deployment-bootstrap.md](./012-ens-deployment-bootstrap.md) —
  `deployedAtBlock` records; dashboard derives deployments from ENS
- [013-ens-write-batching.md](./013-ens-write-batching.md) — resolver
  `multicall` batching to cut wallet prompts
- [014-cli-ens-first-reads.md](./014-cli-ens-first-reads.md) — CLI reads go
  ENS-first, profiles become cache
- [015-ensv2-adoption.md](./015-ensv2-adoption.md) — ENSv2 beta on Sepolia:
  subname registries, Enhanced Access Control, agents as namespaces
  (ETHOnline 2026 ENS track)
