# Sepolia-only ops lane + config guard (discovery unblock)

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## Problem

Two things block the org / swarm / agent discovery views (ticket 002, already
implemented) from showing real data:

1. **No swarm/treasury deployments the dashboard can watch.** The existing
   swarm `ops` lives on 0G Galileo, but the project now standardizes on
   **Sepolia-only**: swarm + treasury contracts deploy to Sepolia like ENS /
   ERC-8004 / documents. The two-lane browser watcher idea is dropped — one
   chain, one `PublicClient`, the existing `client.ts` stays as-is.
2. **Empty/malformed `DEPLOYMENTS` crashes.** A `[]` (or unparseable) array
   parses as *valid* config with zero sources; the watcher constructor then
   throws `SoulVaultEventWatcher needs at least one deployment source` as an
   unhandled rejection instead of rendering the config-error panel (violates
   ticket 001's "missing config shows the config error" AC).

## What to build

### A. Config guard (apps/web)

- `SoulVaultEventsProvider` / `parseSoulVaultClientConfig`: empty
  `deployments` array and `JSON.parse` failure must both land in the existing
  config-error state (`status: 'error'`, `CONFIG_ERROR` message) — no watcher
  construction, no unhandled rejection. Wrap the parse in try/catch.

### B. Migration runbook — redeploy ops contracts on Sepolia (CLI)

The ops lane is fully driven by `SOULVAULT_RPC_URL` + `SOULVAULT_CHAIN_ID`
(`packages/node/src/config.ts` defaults are 0G; signer, `swarm-deploy`,
`treasury-deploy`, and ENSIP-11 treasury discovery via
`coinTypeForChain(SOULVAULT_CHAIN_ID)` all read them). **No CLI code changes
needed** — point the ops lane at Sepolia and redeploy:

1. `.env` (repo root):
   ```bash
   SOULVAULT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
   SOULVAULT_CHAIN_ID=11155111
   # SOULVAULT_ETH_RPC_URL stays the same RPC — both lanes are Sepolia now.
   ```
2. `soulvault organization create --name <org> --ens-name <org>.eth --public`
   (skip if reusing an org whose ENS the wallet already owns — e.g.
   `soulvault-demo.eth` — and skip `register-ens` if already registered).
3. `soulvault treasury create --organization <org>` — deploys
   `SoulVaultTreasury` on **Sepolia** and publishes it via ENSIP-11
   `addr(orgNode, 0x80000000 | 11155111)`.
4. `soulvault swarm create --organization <org> --name <swarm>` —
   auto-discovers the Sepolia treasury and bakes it into the constructor.
5. Join/approve per story00 §6–§9; fund the treasury + fund-request loop per
   story08.
6. The old 0G swarm profile (`~/.soulvault/swarms/ops.json`) is retired:
   `soulvault swarm remove ops` (archives it) so it cannot be selected by
   mistake. Its 0G contract stays on-chain but is no longer referenced.

Gas cost note: Sepolia deploy + ENS writes need a **funded Sepolia** signer
key (the same one used for `register-ens`).

### C. Dashboard config (apps/web/.env.local)

Everything on one chain — the single-chain watcher now sees all kinds:

```bash
NEXT_PUBLIC_SOULVAULT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
NEXT_PUBLIC_SOULVAULT_CHAIN_ID=11155111
NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS=[
  {"kind":"swarm","address":"0x<new swarm>","fromBlock":<deploy block>,"label":"<swarm>"},
  {"kind":"treasury","address":"0x<new treasury>","fromBlock":<deploy block>,"label":"<org>"},
  {"kind":"identity","address":"0xfFb7D6E80E962f3A6c7FB29876C97c37F088a266","fromBlock":10592315,"label":"erc8004"}
]
```

Identity entry can be added immediately (existing ERC-8004 registry, agentId
#2 activity from block `10592315`); swarm/treasury entries follow the
redeploy in step B.

### D. Spec/docs updates

- `docs/redaction-hydration-spec.md` + glossary: ops lane = Sepolia; 0G
  references become historical.
- Root `.env.example`: update `SOULVAULT_RPC_URL`/`SOULVAULT_CHAIN_ID`
  defaults/comments to Sepolia.
- `skills/soulvault/references/env.md` per repo rules (env var semantics
  changed: ops lane no longer implies 0G).

## Acceptance criteria

- [ ] Empty `DEPLOYMENTS` (`[]`) and malformed JSON both render the
      config-error panel; no unhandled rejection (unit test covers both).
- [ ] With the Sepolia-only config, one session shows: swarm
      membership/epoch, agent profiles (ERC-8004), and events table — all
      from Sepolia events.
- [ ] Same-tx `FundRequestApproved` → `FundsReleased` pair renders in order
      (existing single-chain ordering contract unchanged).
- [ ] After the B runbook: `swarm status` reports a Sepolia swarm bound to a
      Sepolia treasury; ENSIP-11 addr record resolves at
      `coinType 0x80000000 | 11155111`.
- [ ] `.env.example`, env reference docs, and hydration spec updated.
- [ ] `pnpm --filter soulvault-web typecheck` + `build:export` green;
      `cd packages/node && pnpm test` green.

## Blocked by

None. **Blocks** ticket 002 from showing real data. Document tickets
(003–006) stay paused until the `SoulVaultDocumentRegistry` deploy path
exists — on Sepolia it can now share this exact `DEPLOYMENTS` config.

## Implementation notes

- Single-chain means `client.ts` needs **no changes** — the guard (A) is the
  only apps/web code change in this ticket.
- Do not re-point the old 0G swarm; retire it (B.6). If 0G returns later, it
  is a config change, not code.
- Keep `SOULVAULT_ENS_*` addresses as-is (they already target Sepolia).
- ENSIP-11 note: after switching, old org names carry a stale 0G coinType
  addr record from earlier treasury deploys. `treasury create` on the new
  lane writes the Sepolia coinType record; `getAddrMultichain(org, 11155111)`
  reads only the Sepolia one, so a stale 0G record does not break discovery —
  but document it in the runbook output so operators don't get confused by
  the extra record on the ENS name.
