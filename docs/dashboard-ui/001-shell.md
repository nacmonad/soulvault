# Dashboard chrome: wallet session, sidebar, org/swarm context

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

Replace the four-panel `/dashboard` placeholder with a wallet-gated shell that
the later tickets fill in.

- `/dashboard/layout.tsx` — sidebar + current-wallet chip + current org/swarm
  context. Nav items: Overview, Organization, Swarm, Agents, Events, Documents
  (Documents expands to Redact / Grants / Rehydrate).
- `/dashboard/page.tsx` — overview: address, connector (ledger | browser-wallet),
  current org name if any, current swarm epoch if any, document count from
  `useDocumentEvents`. No fake stats.
- Wire `SoulVaultEventsProvider` into `AppProviders` beside
  `SoulVaultLedgerProvider`. First dashboard mount calls `refresh` (or `live`).
- Connect panel uses the existing provider: `connectLedger()` and
  `connectBrowserWallet()`. Remove the disabled “Connect wallet” button.
- Unauthenticated: layout still renders, main pane is the connect card, nav
  links are visible but destination pages show the same connect gate.
- Persist `{ orgId, swarmId }` per wallet in `localStorage`. Missing values are
  empty, not errors.
- Follow `apps/web/brand/identity.md`. Keep `PageShell` patterns (eyebrow, squared
  borders, `chip` for status).

Placeholder child routes may 404 until the next ticket; the nav must still
point at the IA paths so that ticket can land without renaming.

## Acceptance criteria

- [ ] Connecting an injected wallet or Ledger sets `address` and reveals
      overview content derived from that address.
- [ ] Disconnect returns the dashboard to the connect card and clears
      address-scoped UI (not the stored org/swarm preference).
- [ ] Sidebar highlights the active route. Documents sub-nav is visible on
      `/dashboard/documents/*`.
- [ ] `SoulVaultEventsProvider` is in the tree; `useEvents` / kind hooks do not
      throw `SoulVault events hooks require <SoulVaultEventsProvider>`.
- [ ] Missing `NEXT_PUBLIC_SOULVAULT_RPC_URL` / `DEPLOYMENTS` shows the existing
      config error, not a blank page.
- [ ] `output: "export"` still builds (`pnpm --filter soulvault-web build:export`).
      No new API routes, no cookies/session.
- [ ] Typecheck green. Brand tokens only (no new saturated hues, no rounded
      primary buttons).

## Blocked by

None (can start as soon as the parent IA is locked).

## Implementation notes

- Do not reimplement DMK session logic; call `useSoulVaultLedger()` (or whatever
  the provider exports after #14).
- Events provider already exists at `apps/web/src/context/SoulVaultEventsProvider.tsx`.
- Static export uses `trailingSlash: true` in export builds; use `Link` hrefs
  that Next’s trailing-slash config accepts.
- Leave org/swarm/agent/events/documents *pages* to later tickets. This PR is
  chrome + overview + provider mount.
