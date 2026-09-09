# Dashboard UI — issue drafts

Successor to [#5](https://github.com/nacmonad/soulvault/issues/5) (closed by PR #14).
The headless redact/rehydrate pipeline exists; this is the wallet-native dashboard
that consumes it, plus navigable placeholders for org / swarm / agent / events.

File these on `nacmonad/soulvault` as GitHub issues. Same shape as #5–#12:

- parent first, then children
- `ready-for-agent` only when acceptance is written
- each child = one mergeable PR
- `Blocked by` is a hard dependency, not a suggestion

| File | Title | Hack status |
|---|---|---|
| [000-parent.md](./000-parent.md) | Wallet-native dashboard: org/swarm/agent shell + documents UI | epic |
| [001-shell.md](./001-shell.md) | Dashboard chrome: wallet session, sidebar, org/swarm context | live |
| [002-placeholders.md](./002-placeholders.md) | Org / swarm / agents / events as navigable read-only views | placeholder + events |
| [003-documents-redact.md](./003-documents-redact.md) | Documents → Redact (demo motor + inline highlight/classify) | live |
| [004-documents-grants.md](./004-documents-grants.md) | Documents → Grants | live |
| [005-documents-rehydrate.md](./005-documents-rehydrate.md) | Documents → Rehydrate | live |
| [006-documents-e2e.md](./006-documents-e2e.md) | Browser e2e: Alice/Charlie/Mallory + Ledger over Speculos | epic gate |
| [007-sepolia-only-ops-lane.md](./007-sepolia-only-ops-lane.md) | Sepolia-only ops lane + config guard | ops backfill |

Do not start Next work until the parent IA is locked in the GitHub issue.

Copy each file body into the issue. Replace `Parent: (this epic)` with the real
parent number after the epic lands.
