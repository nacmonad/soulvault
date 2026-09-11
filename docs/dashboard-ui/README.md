# Dashboard UI — issue drafts

Successor to [#5](https://github.com/nacmonad/soulvault/issues/5) (closed by PR #14).
The headless redact/rehydrate pipeline exists; this is the wallet-native dashboard
that consumes it, plus navigable placeholders for org / swarm / agent / events.

File these on `nacmonad/soulvault` as GitHub issues. Same shape as #5–#12:

- parent first, then children
- `ready-for-agent` only when acceptance is written
- each child = one mergeable PR
- `Blocked by` is a hard dependency, not a suggestion

Status (2026-09-09): the create-wizards epic (#009 + treasury/swarm tabs) is
merged to `main` via PR #21. Ticket 012 §D (DocumentRegistry discovery) has its
v1 side on `main`: ENSIP-11 fallback in `documentRegistryAddress()` + optional
`registry` hint on the public bundle. ENSv2 dispatch tracks 015.

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
| [008-treasury-tab.md](./008-treasury-tab.md) | Treasury tab: fund-request lifecycle in the browser | live |
| [009-create-flows.md](./009-create-flows.md) | Creation wizards: treasury + swarm from the dashboard | live |
| [010-browser-rpc-settings.md](./010-browser-rpc-settings.md) | Browser RPC override + rate-limit-safe log fetching | live |
| [011-ens-native-state.md](./011-ens-native-state.md) | ENS-native state: eliminate `~/.soulvault` as a data layer | epic |
| [012-ens-deployment-bootstrap.md](./012-ens-deployment-bootstrap.md) | ENS deployment bootstrap: derive deployments from ENS records | draft — §D v1-side on main |
| [013-ens-write-batching.md](./013-ens-write-batching.md) | ENS write batching: resolver multicall to cut wallet prompts | draft |
| [014-cli-ens-first-reads.md](./014-cli-ens-first-reads.md) | CLI reads go ENS-first: profiles become caches | draft |
| [015-ensv2-adoption.md](./015-ensv2-adoption.md) | ENSv2 adoption: agents as namespaces on the beta registry | draft |
| [016-wizard-existing-deployment.md](./016-wizard-existing-deployment.md) | Create wizards: detect and adopt existing deployments | draft |
| [017-eip7702-batch-executor.md](./017-eip7702-batch-executor.md) | EIP-7702 batch executor: one-signature atomic wizard flows | draft |
| [018-document-registry-deploy.md](./018-document-registry-deploy.md) | DocumentRegistry deploy + ENS announce: CLI command + browser wizard + Registry admin page | implemented on otto/dashboard-ui |
| [019-multi-chain-event-watcher.md](./019-multi-chain-event-watcher.md) | Multi-chain event watcher: one transport per chain (Galileo treasury events) | draft |
| [020-deployer-factory-cal.md](./020-deployer-factory-cal.md) | Audited deployer-factory → fixed addresses → Ledger CAL descriptors (kill the blind-sign screen walk) | draft |
| [021-device-derived-slot-keys.md](./021-device-derived-slot-keys.md) | Device-derived deterministic slot keys (Ledger Key Ring / OpenPGP) | idea — parked |
| [022-presentation-g0.md](./022-presentation-g0.md) | Presentation: G0 one-liner, demo order, redaction-model comparison | live |
| [024-recording-runbook.md](./024-recording-runbook.md) | Recording order for today’s take — no product change | live |

Do not start Next work until the parent IA is locked in the GitHub issue.

Copy each file body into the issue. Replace `Parent: (this epic)` with the real
parent number after the epic lands.
