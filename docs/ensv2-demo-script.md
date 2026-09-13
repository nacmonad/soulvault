# ENSv2 live demo script (Phase 5, item 14)

End-to-end ENSv2 demo for the developer challenge: every command is real, no
hardcoded values — names, addresses, and expiries come from the runs themselves.
Prerequisites: a **funded Sepolia wallet** (signer key in the harness — see
`SOULVAULT_SIGNER_MODE`), `SOULVAULT_ENSV2=1`, RPC `https://ethereum-sepolia-rpc.publicnode.com`.

Set the lane once:

```bash
export SOULVAULT_ENSV2=1
export SOULVAULT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export SOULVAULT_CHAIN_ID=11155111
```

## Act 0 — Org registry (the config layer)

```bash
soulvault organization deploy-registry --organization soulvault
```

→ Deploys the org's SoulVaultRegistry through ENSv2's VerifiableFactory
(verifiable proxy: anyone can recompute the address from factory + impl + salt +
initData), verifies `ROLE_REGISTRAR` on the root **onchain** before trusting the
address, and records it on the org profile.

Capture: `registry` address from output.

## Act 1 — Swarm with epoch-bound expiry

```bash
soulvault swarm register-ens --registry <registry> --label ops \
  --expiry-days 30 --with-agent-namespace
```

- Registers `ops.soulvault.eth` with expiry = now + 30d (the epoch cadence).
- `--with-agent-namespace` self-points the swarm's subregistry at the org
  registry so agent names resolve beneath it (item 10).
- Owner receives `SET_RESOLVER | RENEW` on the name's resource.

## Act 2 — Scoped EAC delegation (the prize demo)

```bash
soulvault ens grant --name ops.soulvault.eth --role set-resolver --to 0xAgent…
soulvault ens roles --name ops.soulvault.eth --account 0xAgent…   # post-tx verification
```

Then show the boundary — from the **agent's** key:

```bash
soulvault ens roles --name ops.soulvault.eth --account 0xAgent…   # has set-resolver only
# attempt a role the agent does NOT hold → rejected onchain
soulvault ens grant --name ops.soulvault.eth --role renew --to 0xOther…
```

The failure is the feature: EAC proves per-name, per-role delegation beats
v1's resolver-level all-or-nothing.

## Act 3 — Agent self-serve records + ERC-8004 bridge

```bash
soulvault agent register-ens --label rustybot --swarm ops
soulvault agent show --ens
```

- `agent register-ens` registers `rustybot.ops.soulvault.eth` (agent wallet gets
  `SET_RESOLVER|RENEW` on its own name) and mirrors `erc8004.registry` +
  `erc8004.agentId` into resolver records.
- `agent show --ens` walks the v2 hierarchy, reads the ERC-8004 pointer records
  back — reverse resolution with zero hardcoded addresses (name-driven, spec §3).

## Act 4 — Wildcard-style resolution (reader path)

From a fresh machine (no local profiles):

```bash
soulvault sync   # bootstraps org/swarm from ENS records alone
```

Reads resolve `ops.soulvault.eth` through the org registry + per-label resolvers
— no per-name resolver deployment, the Phase 1 `walkEnsV2Registry` doing its job.
(otto dashboard section D mirrors this read path in the browser.)

## Act 5 — Expiry as liveness (treasury renewal job)

```bash
soulvault epoch rotate --swarm ops
```

Watch the output line: `ENSv2 subname renewed: … → expiry <now+30d> (tx: 0x…)`.
Each rotation renews the name in the same flow that publishes the new key
bundle — name expiry can never outrun operational continuity. Show `getState`
before/after:

```bash
# before rotate: expiry T; after: T + 30d
```

## Act 6 — Succession: burn the name, restore via Key Ring

Charlie v1 is dead (wallet gone). The name is the identity; the owner's
`wallet-cli` ring is the key. Peers never held `K_epoch`.

```bash
# Owner: burn v1's sub-sub-name (ROLE_UNREGISTER at org root)
soulvault ens burn --name charlie.ops.soulvault.eth

# Charlie v2 (fresh wallet) joins, then self-registers the same label
soulvault swarm join-request --swarm ops
# owner: approveJoin
soulvault ens grant --name ops.soulvault.eth --role registrar --to 0xCharlieV2…
soulvault agent register-ens --label charlie --swarm ops   # as v2

# v2 asks; owner's ring derives the agent-specific epoch key and ECDH-grants
soulvault swarm request-epoch-key \
  --key-name 'soulvault:epoch-recovery:charlie.ops.soulvault.eth:epoch-000007' \
  --reason 'charlie v2 succession'
# owner (Ledger + wallet-cli ring): decrypt escrow on the ring, wrap to v2 pubkey
soulvault msg post --swarm ops --topic epoch-key-grant --mode dm --to 0xCharlieV2…
```

Beats to narrate:

1. **EAC** — v1 registered `charlie.ops.soulvault.eth` itself (sub-sub-domain).
2. **Burn** — owner unregisters the token; the label is free; the old ERC-8004
   record stays frozen (lost wallet cannot update it).
3. **Ring** — owner derives `soulvault:epoch-recovery:<agent-ens>:epoch-<n>`
   from the Ledger Key Ring. No member stored `K_epoch`. No peer can peek.
4. **Self-restore** — v2 re-registers the name, opens the ECDH grant with its
   new key, memories come back byte-identical.

Do not enroll Charlie into the org ring. Isolation is "owner derives, successor
receives a DM" — not "every agent is a ring member."

## Wrap-up beats

1. Registry IS the config layer — `organization deploy-registry` replaced the
   CBOR membership list with real registry entries.
2. Scoped delegation — agent edits its records, cannot grant or unregister.
3. Expiry tracked to epochs — renewal is part of rotation, not a cron afterthought.
4. ERC-8004 ↔ ENS both directions — write path (`register-ens`), read path
   (`show --ens`).
5. Succession — burn the sub-sub-name, re-issue the label, restore memories
   from the owner's `wallet-cli ring`. Swarm members never held the key.

## Recording notes

- Screen-record the full run; narrate each act against the spec section it
  satisfies (§4 phases 1–4, items 9–14, plus Act 6 succession).
- Show etherscan links for: deploy-registry proxy creation, swarm register,
  grant tx, agent register, epoch rotate (two txs: rotate + renew),
  `ens burn`, v2 `register-ens`, `request-epoch-key`.
- Fallback if RPC is flaky: the forge spike (`contracts/ensv2/`, 6/6 tests)
  demonstrates identical semantics locally; run it after the live attempt.
