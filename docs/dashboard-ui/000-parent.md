# Wallet-native dashboard: org/swarm/agent shell + documents UI

## Problem Statement

PR #14 shipped a UI-agnostic redact/rehydrate pipeline: local Presidio review,
versioned JSON bundles, Sepolia document-registry events, and wallet-attested
slot grants. `apps/web` still has a four-panel dashboard placeholder, an unwired
Connect-wallet button, and no routes under `/dashboard`. The event layer
(`SoulVaultEventsProvider`, kind hooks, reducers) is in the tree but not mounted
in the app providers.

Judges and operators need a wallet-native dashboard that:

1. Navigates org / swarm / agent / events even when those write-paths are not
   ready this event.
2. Runs the ETHOnline document loop: redact → grant → rehydrate, with World
   Selfie Check and Ledger clear-sign as gates on the consumer path.

#5 explicitly deferred “a general dashboard or polished document-management UI.”
This epic is that work.

## Solution

Add a static-export-safe App Router tree under `/dashboard`. Connecting a wallet
(Ledger via existing `SoulVaultLedgerProvider`, or injected browser wallet) is
identity. Every panel reads chain events through the existing watcher/reducers.
No API routes, no account database.

### Information architecture

| Route | Hack status | Bind |
|---|---|---|
| `/dashboard` | live chrome | wallet session, current org/swarm summary |
| `/dashboard/org` | **placeholder** | ENS name/records, org switcher; metadata edit `soon` |
| `/dashboard/swarm` | **placeholder** | `useSwarmEvents` (members, pending joins, epoch) |
| `/dashboard/agents` | **placeholder** | `useAgentEvents` (ERC-8004 uri/metadata); edit `soon` |
| `/dashboard/events` | live-enough | `useEvents` + kind/tx filter |
| `/dashboard/documents/redact` | **live** | Demo **motor** (not look): module worker + adapter `PresidioWorkerClient` / `redactAcceptedFindings` + `DocumentPublished`. See child ticket. |
| `/dashboard/documents/grants` | **live** | `createSlotKeyGrants` → `SlotKeyGranted` |
| `/dashboard/documents/rehydrate` | **live** | upload bundle, verify `docHash` vs registry, toggle granted slots via `rehydrateGrantedDocument` |

`/dashboard/documents` redirects to `redact`.

Placeholders are real routes that render reduced state (or an honest empty
state). Write-paths (ENS text-record edit, ERC-8004 metadata write, org create)
stay `soon` so nav does not get ripped later.

Visual system is already locked in `apps/web/brand/identity.md` (indigo/slate,
Inter + IBM Plex Mono). Do not invent a second look.

### Children

1. Dashboard chrome: wallet session, sidebar, org/swarm context
2. Org / swarm / agents / events as navigable read-only views
3. Documents → Redact
4. Documents → Grants (blocked by 3)
5. Documents → Rehydrate (blocked by 4)

## User Stories

1. As a wallet holder, I want connecting Ledger or an injected wallet to be the
   only sign-in, so there is no account database.
2. As an org owner, I want to see ENS name and records for organizations I
   control, and switch among them, so the rest of the dashboard has a current org.
3. As an org owner, I want ENS metadata editing left as a visible `soon` action,
   so we can return to it without inventing a new nav.
4. As a swarm operator, I want to select a swarm and see membership and epoch
   from chain events.
5. As an operator, I want an agent directory of ERC-8004 uri + metadata, with
   edit left `soon`.
6. As an operator, I want a filterable event log (kind, address, tx) over the
   shared watcher cache.
7. As a document author (Alice), I want to paste or upload text, review Presidio
   findings locally, accept spans, and publish a redacted bundle plus registry
   anchor — plaintext never leaves the browser during preparation.
8. As a document author, I want to grant selected slots to a recipient wallet
   that has attested a rehydration key, with the grant event carrying the wrap.
9. As a recipient (Charlie), I want to upload the JSON bundle, verify its
   `docHash` against the registry, and toggle only granted slots back to
   plaintext.
10. As an unauthorized wallet (Mallory), I want ungranted markers to stay
    redacted and hydration to fail closed.
11. As a recipient, I want World Selfie Check and Ledger clear-sign as explicit
    gates on rehydrate (and Ledger as a signer on grant), not as protocol changes.
12. As a maintainer, I want every dashboard route to keep `output: "export"`
    green — no API routes, no server session.

## Implementation Decisions

- Static export stays (`SOULVAULT_WEB_EXPORT=1`). All data paths are client-side
  (wallet + RPC + existing event watcher). The Graph may later replace RPC
  behind the watcher; it is not required for this epic.
- Mount `SoulVaultEventsProvider` next to `SoulVaultLedgerProvider` in
  `AppProviders`. Do not reimplement watchers or reducers.
- Reuse `useDocumentEvents`, `useSwarmEvents`, `useAgentEvents`, `useEvents`.
  Org ENS has no reducer yet; the org placeholder resolves ENS for the connected
  wallet and lists known names. Do not invent an org event kind.
- Protocol stays headless. UI calls `@soulvault/protocol` and
  `@soulvault/presidio-adapter`. Slot keys never enter the public bundle, events,
  logs, or error strings.
- Documents/redact follows
  [`nacmonad/presidio-web-demo`](https://github.com/nacmonad/presidio-web-demo)
  **programmatically** (module worker, recognizer set, requestId/stale drop,
  overlap merge, value normalization, high-to-low replace, file accept list,
  scan-text snapshot). It does **not** follow the demo aesthetically (no demo
  layout/CSS/brand/vault panel). The demo’s in-memory plaintext vault is not
  storage; adapter `slotId` + protocol encryption replace it. Per-occurrence
  accept/reject is required (the current demo auto-redacts every finding).
- A delivered READ grant is a permanent capability (spec §3). The UI must not
  offer revoke, expiry, or “un-read” copy.
- World Selfie Check and Ledger clear-sign are grant/rehydrate *gates*. They are
  not embedded in `packages/protocol`.
- Brand: `apps/web/brand/identity.md`. Squared corners, indigo for interactive,
  red only for irreversible actions (none of which exist on READ grants).
- Current org/swarm live in browser storage keyed by wallet address, not in a
  server. Switching org updates the rest of the dashboard context.
- Documents sub-tabs are real routes, not query-param tabs, so static export and
  deep links work.

## Testing Decisions

- Shell: wallet connect (browser wallet mock + existing Ledger/Speculos path)
  establishes address; unauthenticated dashboard shows the connect panel only.
- Placeholders: with fixture events, swarm/agent/events views render reduced
  state; with none, they render empty states, not errors. Org switcher changes
  context without a reload.
- Redact: accepted findings only enter `redactAndEncryptDocument`; public
  serialization contains no plaintext or slot keys; `DocumentPublished` matches
  artifact `documentId` / slot ids.
- Grants: invalid attestation fails closed; valid grant emits `SlotKeyGranted`
  with the protocol wrap; UI never displays raw slot keys.
- Rehydrate: Charlie hydrates exactly granted slots; Mallory gets no plaintext;
  `docHash` mismatch fails before unwrap; World/Ledger gates block hydration
  when configured and fail closed when skipped.
- `pnpm --filter soulvault-web typecheck` and `build:export` stay green.
- Fixtures stay synthetic. No real PII.

## Out of Scope

- ENS text-record write, org create/register, ERC-8004 metadata write (nav
  targets exist; controls are `soon`).
- USE-without-READ, TEE, x402, Graph as a hard dependency.
- Revocation, grant expiry, “forget this field.”
- PDF/DOCX/OCR round trips.
- Server-side redaction or key custody.
- Redesign of the landing page or brand.
- Editing `packages/protocol` reducers/watchers unless a genuine bug blocks UI.

## Further Notes

- Local `apps/web` `main` in some clones is behind `origin/main` (PR #14).
  Branch dashboard work from `origin/main` @ `396c9a4` or later.
- CLI stories 00–02 are the org/swarm/agent *read* model the placeholders
  should mirror, not rewrite.
- Visual mockups are not a deliverable; the existing Next/shadcn stack is.
