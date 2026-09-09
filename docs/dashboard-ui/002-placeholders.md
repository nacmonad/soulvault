# Org / swarm / agents / events as navigable read-only views

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

Ship the retroactive surfaces as real routes with reduced state, so we can
return to write-paths without changing nav.

### `/dashboard/org`

- List organizations associated with the connected wallet (ENS names the wallet
  owns / is set as controller, plus any locally remembered names).
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

## Implementation notes

- There is no org reducer in `apps/web/src/lib/onchain/reducers.ts`. Do not
  fake one from swarm events. Resolve ENS read-only via viem (Sepolia) for
  names the operator supplies or that the wallet owns.
- Reuse CLI mental model from `stories/story00.md` / `story01.md` / `story02.md`
  for copy (organization namespace, swarm namespace, ERC-8004 identity).
- Fund-request columns are out of scope even though `reduceSwarmState` has
  them; a `soon` chip on the swarm page is enough.
