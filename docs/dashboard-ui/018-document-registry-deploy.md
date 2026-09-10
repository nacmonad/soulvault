# DocumentRegistry deploy + ENS announce (CLI + dashboard)

## Parent

[012-ens-deployment-bootstrap.md](./012-ens-deployment-bootstrap.md) §D — DocumentRegistry
discovery (documents lane)

## Problem

The documents lane (redact → publish → grant → rehydrate) resolves the
`SoulVaultDocumentRegistry` through the discovery chain (override → ENS → env → bundle
hint), but nothing deployed or announced it: with no ENS record and no
`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` entry, Redact cannot publish and Grants/Rehydrate
are blocked. The deploy existed only as an ad-hoc forge step.

## What shipped

### Where the registry lives

Sepolia (identity lane), one global singleton per chain — not org-scoped. External
consumers publish/verify/rehydrate without swarm membership, so it sits on the public
chain next to ENS.

### v1 announce (ENSv1 track)

On the **protocol root ENS name** (resolved from the active organization's `ensName`
— e.g. `soulvault-demo.eth` — falling back to `soulvault.eth`; the registry itself is
not org-scoped):

1. ENSIP-11 `addr(rootNode, coinType(11155111))` — the record
   `resolveDocumentRegistryAddress()` reads (source of truth).
2. `soulvault.documentRegistry` text record — a **chain-keyed JSON array** (one
   `{chainId, address, deployedAtBlock, deployedAt}` entry per chain), mirroring the
   `soulvault.treasuries` enumeration pattern and carrying the deploy block for event
   scan windows (ticket 012 §A pattern). Array shape means a future second-chain
   deploy extends the record instead of clobbering the first entry.

The signer must own the root name: one action per chain, not a per-org flow. The root
name resolves as: active organization's `ensName` (CLI) / dashboard-selected org (web)
→ env (`SOULVAULT_ENS_ROOT_NAME` default `soulvault.eth`) → `--root-ens-name` always
wins on the CLI.

### CLI

`soulvault document deploy-registry` (`--root-ens-name`, `--chain-id`, `--skip-ens`) —
`packages/node/src/document-registry-deploy.ts`, handler in
`apps/cli/src/commands/document.ts`. Loads the forge artifact from `out/`, deploys on
the identity lane with the ENS signer, writes both records, prints an optional
`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` snippet.

### Browser

- `DOCUMENT_REGISTRY_ARTIFACT` added to `apps/web/src/lib/contracts-artifacts.ts`
  (generator updated; run `forge build && node scripts/generate-contract-artifacts.mjs`).
- `runDocumentRegistryDeploy` in `apps/web/src/lib/create-flows.ts` — wallet-native
  wizard flow (deploy → ENSIP-11 addr → text record upsert), one wallet prompt per step,
  byte-parity intent with the CLI.
- `DocumentRegistryWizard` (`apps/web/src/components/create/document-registry-wizard.tsx`)
  embedded in the new **Documents → Registry** admin page
  (`apps/web/src/app/dashboard/documents/registry/page.tsx`): resolved registry + source,
  browser override management, the ENS text record read-back, the deploy wizard, and the
  env snippet fallback. The Redact page shows the resolved registry (with source) or an
  amber banner linking to the Registry page when nothing is discovered.

### Failure recovery + error surfacing

- Every wizard catch renders the message through `errorMessage()`
  (`apps/web/src/lib/error-message.ts`) — the wallet/DMK/viem layers reject with plain
  objects (`{code, message}`, `{_tag, errorCode}`) as often as `Error` instances, and
  `instanceof Error` checks lost those payloads (`[object Object]`). Failed steps are
  also marked ✗ instead of spinning on "…".
- The wizard's error block carries a **CLI recovery command** (`CliRecoveryHint`):
  `document deploy-registry` before the deploy lands, and — once the deploy tx is
  on-chain — `document announce-registry --address … --deployed-at-tx …`, which performs
  only the ENS writes against the already-deployed contract (no second deploy, no wasted
  gas).
- Unhandled-rejection fixes: the DMK device-session subscription now has an error
  handler (a session error mid-sign used to rethrow globally as `[object Object]`), the
  unmount `dmk.disconnect` gets a catch, and all fire-and-forget `navigator.clipboard` /
  `navigator.storage` calls swallow rejections.

## Acceptance criteria

- [x] `forge build` + artifact generation includes `SoulVaultDocumentRegistry`.
- [x] CLI deploys + announces (unit tests for record parse/upsert; typecheck green).
- [x] Browser wizard deploys the same bytecode via `deployWalletContract` and writes
      the same ENS records (typecheck + web test suite green).
- [x] Registry admin page exposes resolution source, override set/clear, and the
      deploy flow; Redact degrades visibly when no registry is discovered.
- [ ] Live run against Sepolia with a wallet that owns the root name (blocked on the
      funded owner wallet — the remaining manual step).

## Notes

- ENSv2 adoption (ticket 015) will move the announce to the v2 record shape; the v1
  ENSIP-11 addr stays the fallback after migration (same dispatch pattern as
  `packages/node/src/ens.ts`).
- The wizard's localStorage override is an operator convenience for immediate use;
  ENS remains the trust anchor and the override should be cleared once the record
  resolves everywhere.
