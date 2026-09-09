# Org / swarm / agents / events as navigable read-only views

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

Ship the retroactive surfaces as real routes with reduced state, so we can
return to write-paths without changing nav.

### `/dashboard/org`

- List organizations from a **localStorage known-orgs registry** keyed by
  the connected wallet. RPC cannot enumerate ENS names owned by an address,
  so the list is built from: (a) an ENS reverse-record lookup (primary name)
  for the connected address, (b) names the operator adds manually, and (c)
  import of CLI state (`~/.soulvault/organizations/*.json`) via file upload.
- Show useful metadata: ENS name, owner, resolver, a short record set (addr,
  text records that already exist). Mirror CLI `organization status` *read*
  fields, not the full CLI write surface.
- Switcher sets the shell’s current org (persisted per wallet).
- “Edit ENS metadata” control is visible and disabled with a `soon` chip.
  Do not implement `setText` / register this event.

### `/dashboard/swarm`

- Swarm selector bound to current org context when a mapping exists; otherwise
  list swarms from configured `swarm` deployments / `useSwarmEvents`.
- Render members, pending joins, current epoch, membershipVersion, treasury
  address from `reduceSwarmState`.
- No join/approve/rotate controls this ticket.

### `/dashboard/agents`

- ERC-8004 directory from `useAgentEvents` (`AgentProfile`: agentId, wallet,
  uri, metadata map).
- Filter to current wallet and/or current swarm members when those addresses
  are known.
- “Edit metadata” / “set URI” disabled `soon`.

### `/dashboard/events`

- Table over `useEvents()`: block, tx (truncated, copyable, etherscan-or-explorer
  link if chain id is Sepolia), `sourceKind`, event name, a one-line arg summary.
- Filters: kind (`document` | `swarm` | `treasury` | `identity`), tx hash,
  address (author/recipient/member). Client-side over the cached log.
- Live toggle calls `startLive` / `stopLive`.

Empty states are first-class: “no organization for this wallet”, “no swarm
events yet”, etc. Never invent rows.

## Acceptance criteria

- [ ] All four routes render under the dashboard shell and are reachable from
      the sidebar.
- [ ] Org switcher updates the shell context and is restored on reload for the
      same wallet.
- [ ] The known-orgs registry persists in localStorage per wallet; importing
      a CLI organization JSON adds it to the list without any ENS write.
- [ ] Swarm view matches `reduceSwarmState` for fixture events (members, epoch).
- [ ] Agents view matches `reduceAgentState` (uri + metadata keys).
- [ ] Events view shows document publish/grant events from the shared cache;
      kind filter hides other kinds; live toggle starts cursor polling.
- [ ] Edit/write controls are present, disabled, and labelled `soon`. No
      dummy writes to ENS or ERC-8004.
- [ ] Unauthenticated visits get the connect gate, not a reducer crash.
- [ ] Typecheck + `build:export` green.

## Blocked by

- Dashboard chrome (shell + `SoulVaultEventsProvider` mount)
- Real swarm/treasury rows: Sepolia-only ops lane + config guard (007).
  Until then these views render empty states from the event cache, not errors.

## Implementation notes

- There is no org reducer in `apps/web/src/lib/onchain/reducers.ts`. Do not
  fake one from swarm events. Resolve ENS read-only via viem (Sepolia) for
  the names in the localStorage registry. Do not attempt to enumerate owned
  names from chain history — that is not feasible with read-only RPC; the
  registry (reverse record + manual add + CLI state import) is the
  discovery surface.
- Reuse CLI mental model from `stories/story00.md` / `story01.md` / `story02.md`
  for copy (organization namespace, swarm namespace, ERC-8004 identity).
- Fund-request columns are out of scope even though `reduceSwarmState` has
  them; a `soon` chip on the swarm page is enough.
