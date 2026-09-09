# Treasury tab — story08 fund-request lifecycle in the dashboard

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## Status

Implemented on `feat/treasury-tab` (single PR): nav entry + `/dashboard/treasury`.

## What shipped

- **Nav:** Treasury item between Swarm and Events (`dashboard-nav.ts`).
- **`/dashboard/treasury`** — the story08 loop in one surface:
  - Stats: treasury `balance()` (chain read), `owner()` (chain read), bound
    swarm (from `swarmDeployment()` / reduced `TreasurySet` state).
  - **Deposit** — any wallet, native value via `deposit()` (payable). Funder
    and approver can differ, per story08.
  - **Fund requests table** — reduced from swarm + treasury events
    (`useSwarmEvents` → `reduceSwarmState().fundRequests`): id, requester,
    amount, reason, status chip (`pending / approved / rejected / cancelled /
    paid`).
  - **Approve / Reject** (owner only, `pending` rows): `approveFundRequest`
    emits the same-tx pair `FundRequestApproved → FundsReleased`;
    `rejectFundRequest` takes an optional reason. Reject-with-no-reason
    defaults the string to "no reason given" (the contract requires one).
  - **Cancel** (requester only, pending rows): `cancelFundRequest`.
  - **Request funds** — member path, `requestFunds(amount, reason)` on the
    swarm. The contract enforces active membership + bound treasury +
    `amount > 0`; the UI surfaces revert messages instead of pre-gating.
  - **Withdraw** (owner only, CLI parity with `treasury withdraw`):
    `withdraw(to, amount)`.
- **`lib/treasury-contract.ts`** — typed write wrappers (viem
  `encodeFunctionData` → `sendWalletTransaction`), `parseEthAmount`
  (`parseUnits(…, 18)`).
- **`wallet-tx.ts`** — `sendWalletTransaction` now accepts optional `value`
  (hex-encoded) for deposits.

## Decisions

- Actions target the **first** `swarm` / `treasury` deployment entry in
  `NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS`. Multi-swarm selection is ticket-002
  selection state, not this tab.
- Approve/reject visibility is gated on the **chain-read** `owner()` (not the
  reducer), so the UI agrees with the contract's `onlyOwner` check.
- Refresh strategy: 3s delay after tx hash → re-read balance/owner; event
  state updates via the live poller (`useSwarmEvents({ live: true })`).
- No `*WithSig` paths in the UI yet — EOA-direct calls only. Ledger-backed
  approval (clear-sign intent signing) stays with the CLI story08 flow until
  the browser DMK session exposes typed-data signing for treasury actions.
- No revocation/expiry copy anywhere: a paid request is final.

## Acceptance criteria (verification)

- [ ] `/dashboard/treasury` reachable from sidebar; connect-gated.
- [ ] Without a `treasury` deployment: honest config empty-state, no crash.
- [ ] Deposit from any wallet increases balance after refresh.
- [ ] Member (active) can file a request; non-member gets the contract
      revert surfaced as UI error text.
- [ ] Owner approves → status flips to `paid`, balance decreases by exactly
      the request amount; `FundRequestApproved` and `FundsReleased` both
      appear in the events page in order.
- [ ] Owner reject (with/without reason) → `rejected`, no funds move.
- [ ] Requester cancel (pending only) → `cancelled`; subsequent owner
      approve attempt reverts (`InvalidRequestState`) and is surfaced.
- [ ] Withdraw only renders for the chain-read owner.
- [ ] Typecheck green for all new files; `/dashboard/treasury` renders 200.

## Known follow-ups (not this PR)

- Multi-treasury selector; per-swarm filtering when several swarms exist.
- `*WithSig` / Ledger clear-sign approval path.
- Creation wizards → ticket 009.
