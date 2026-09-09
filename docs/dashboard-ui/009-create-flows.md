# Create flows — treasury create + swarm create as guided wizards

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## Problem

Bootstrap lives only in the CLI (story00 + story08 §0): `treasury create`
then `swarm create` are multi-transaction flows involving contract deploys
plus ENS writes. Operators currently bounce between CLI and dashboard. The
dashboard should bake these stories in as guided, verifiable wizards so the
full lifecycle — create treasury → create swarm (auto-binds treasury) →
fund → request → approve — is drivable from the browser.

## Scope (grounded in the stories)

### Wizard 1: Treasury create (story08 §0)

1. Read the current org ENS name from dashboard selection (`selection.orgId`).
   Require it — a treasury is org-scoped and its ENSIP-11 record needs the
   org node.
2. Deploy `SoulVaultTreasury` (no constructor args; deployer = immutable
   owner, `chainId = block.chainid`).
3. Publish the treasury address on the org ENS name via ENSIP-11 multichain
   `addr` (`coinType = 0x80000000 | chainId`, 3-arg
   `setAddr(bytes32,uint256,bytes)` on the org's resolver).
4. Show the resulting address + tx hashes; offer "Add to config" — the wizard
   cannot edit server env, so it displays a ready-to-paste
   `NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` fragment (see Decisions).

### Wizard 2: Swarm create (story00 §4)

1. Require an org with a resolvable treasury (ENSIP-11 read at the Sepolia
   coinType). Offer `--treasury`-style override + explicit "no treasury"
   opt-out (address(0)), mirroring the CLI's three-mode precedence.
2. Deploy `SoulVaultSwarm(initialTreasury)` — the constructor binds the
   treasury at deploy time (no separate `set-treasury` step).
3. ENS subdomain binding (story00 §4): `setSubnodeRecord` on the org node
   with the swarm label, `setAddr(swarmNode, contract)`, and text records
   `soulvault.chainId` + `soulvault.swarmContract` (CLI parity:
   `bindSwarmEnsSubdomain`).
4. Append the swarm label to the org's CBOR `soulvault.swarms` list text
   record (org listing semantics — same wire format as the CLI writes).
5. Result card: contract address, ENS name, tx list, and the
   ready-to-paste `DEPLOYMENTS` snippet with both new entries.

Each wizard step = one wallet prompt, sequential, with the tx hash + explorer
link shown as each lands. A failed mid-sequence step must show exactly which
step failed and what remains (e.g. "contract deployed at 0x… but ENS binding
incomplete — re-run step 3").

## Decisions

- **Bytecode sourcing:** import the Foundry artifacts at build time — a small
  generated module (`apps/web/src/lib/contracts-artifacts.ts`) or JSON
  imports from `out/*.sol/*.json`, guarded by a build-time check. Do not
  fetch bytecode at runtime; static export has no server. Keep both
  artifacts' ABI + `bytecode.object` only (strip metadata bloat if the
  bundle grows; measure first).
- **Deploy path:** viem `walletClient.deployContract` equivalent via
  `eth_sendTransaction` with empty `to` + `data = bytecode` (same
  `sendWalletTransaction` primitive — extend it to accept `to: null`).
  Wait for the receipt by polling `publicClient.waitForTransactionReceipt`,
  then read the deployed address from the receipt `contractAddress`.
- **ENS writes** go through viem ENS actions / raw resolver calls on Sepolia:
  `setAddr(bytes32,uint256,bytes)` overload with `coinTypeForChain(11155111)`
  semantics (port the coinType math from `packages/node/src/ens.ts` — do not
  import the node package into the browser bundle).
- **Post-deploy discovery parity:** the wizard reads back what it wrote
  (`getAddrMultichain` equivalent + `swarm.treasury()`) before declaring
  success — fail loud with a partial-state summary.
- The wizards write **only** what the CLI writes. No new record types, no
  org registration in this ticket (`organization register-ens` remains
  CLI-only; the wizard errors honestly if the org ENS is not owned by the
  connected wallet).
- EIP-712 domain "SoulVaultTreasury" v1 / "SoulVaultSwarm" v1 are created by
  the contracts themselves; the wizard does not sign typed data.

## Acceptance criteria

- [ ] Wizard 1 deploys a treasury and writes the ENSIP-11 record; the CLI
      `getAddrMultichain(org, 11155111)` resolves it (cross-check in story).
- [ ] Wizard 2 deploys a swarm whose `treasury()` equals the discovered
      address; ENS subdomain + text records resolve.
- [ ] Every step shows tx hash + explorer link; partial failure leaves an
      honest "completed steps / remaining steps" card, no silent retries.
- [ ] Bytecode is bundled at build time; no runtime fetch; `build:export`
      stays green and static.
- [ ] Connected-address ownership is validated before each ENS write
      (resolver authorization follows the org node owner — same wallet).
- [ ] Speculos/Ledger: deploy + ENS writes are plain txs, so the Ledger
      connector signs them through the existing session when connected.
- [ ] After both wizards, the dashboard config snippet can be pasted and the
      Treasury/Swarm tabs immediately reduce the new contracts' events.

## Blocked by

- None hard; assumes ticket 007's guard (empty/malformed config renders the
  config error) so the "paste config" handoff has a safe fallback.
- Convenient but not required: document registry deploy-path ticket — same
  "operator deploys from UI/CLI" shape.

## Implementation notes

- Reuse `selection.orgId` + the org page's ENS read path for the org node;
  do not invent a second org registry.
- Gas estimates for each step should display before the prompt (wallets show
  them anyway; the wizard adds step context, not approval UI).
- The CBOR `soulvault.swarms` list append must byte-match the CLI writer
  (`packages/node/src/ens.ts` org-list helpers). If the browser port drifts,
  org listing in story01-style consumers breaks — add a round-trip test
  against a CLI-written list fixture.
- Keep both wizards out of the events cache path — they are write flows; the
  resulting contract state surfaces through the existing watchers.
