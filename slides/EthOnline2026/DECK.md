---
marp: true
theme: default
paginate: true
title: SoulVault — ETHOnline 2026
header: 'SoulVault — ETHOnline 2026'
style: |
  section { font-size: 28px; }
  h1 { font-size: 1.6em; }
  header { font-size: 14px; color: #666; }
  footer { font-size: 12px; color: #888; }
  a { color: #2563eb; }
  code { font-size: 0.85em; }
---

<!-- _header: '' -->
<!-- _paginate: false -->

# SoulVault

## Local PII redact + wallet-authorized rehydrate

![bg right:38% 75%](media/hero-logo-w.png)

**G0:** Redact on your machine. Authorized wallets rehydrate only the fields they're allowed to see.

ETHOnline 2026 · Continuity · ENS · Ledger · World

---

# Problem

- Sharing a clinic note today means sending the **whole file**
- SaaS PII detection still ships the document over the wire
- Need per-field disclosure, an authorization trail, and **no SoulVault server** holding keys

**Verify, don't trust.** Ciphertext never leaves the author's machine.

---

# What this event ships

- Presidio in the browser. PII never leaves Alice's machine
- Redacted artifact travels on ordinary channels
- Per-slot keys, ECDH-wrapped to the requester, delivered as `SlotKeyGranted`
- Same wrap as Cannes epoch bundles / DMs — now on document slots

Dashboard: `/dashboard/documents/{redact,grants,rehydrate}`

---

# Sequence

```
Alice  →  DocumentRegistry.publishDocument(docHash, slotIds)
Charlie → requestRehydration(docHash, pubkey)     ★ 1 Ledger sig
Alice  →  grantSlotKey × slots   (wrap = ECDH to pubkey)
Charlie ← SlotKeyGranted events  → unwrap granted slots only
```

- Onchain: `docHash` + slot ids + wrapped keys. **No PII.**
- Events = who was **granted** which field (not "who has seen")
- One device signature authorizes N slots

---

<!-- _header: 'Sponsor — ENSv2' -->

# ENSv2 — the app has no backend

![bg right:22% 55%](media/ens-icon-blue.png)

Org name holds swarm / treasury / documentRegistry addresses (+ chainIds).

CLI + dashboard parse **logs and events**. No persistent `.json` configs. No config server.

Kill ENS: Alice pastes a registry address; Charlie cannot find it on a fresh browser.

**Live org:** `soulvault-ensv2.eth` (island registry)

---

# ENSv2 EAC — agents own their name

- Org grants `ROLE_REGISTRAR` on the swarm. Agent **self-registers** `charlie.ops.<org>.eth` (`SET_RESOLVER` on that name only)
- Owner **burns** the sub-sub-domain (`ROLE_UNREGISTER`) when the agent dies / misbehaves
- Successor re-registers the **same label**. Name is the identity; wallet is replaceable

**Live (Sepolia, 2026-09-13):**

| Name | Status |
|---|---|
| `demo.soulvault-ensv2.eth` | registered (org swarm label) |
| `ops.soulvault-ensv2.eth` | swarm `0xc0af9C09…D426C` |
| `charlie.ops.soulvault-ensv2.eth` | owner `0xe3b4D0e0…3B47` · ERC-8004 id **5** |

Charlie v2 is the burn + re-register beat — v1 is still live (not burned yet).

---

<!-- _header: 'Sponsor — Ledger' -->

# Ledger — HITL + Key Ring

![bg right:28% 50%](media/LEDGER-WORDMARK-BLACK-CMYK.png)

**Documents path:** host UI can lie; the Nano cannot. Charlie attests the rehydration pubkey on-device. One sig, N slots.

**Agent continuity (`wallet-cli ring`):** named keys are **derived**, not stored.

```
ring init                  ★ the device tap (enrollment)
ring encrypt/decrypt --key soulvault:epoch-recovery:<agent-ens>:epoch-<n>
```

Do **not** enroll peer agents into the org ring.

---

# Then `K_epoch` vs now Key Ring

| Then (Cannes) | Now (`feature/epoch-key-ring`) |
|---|---|
| Members stored `K_epoch` so a dead agent could recover | Owner Ledger + ring **derives** the agent-epoch key |
| Any member could **peek** at another agent's backup | Peers never held the key |
| Identity = wallet | Identity = ENSv2 name |

Restore: `requestEpochKey` → owner derives on the ring → ECDH grant DM → v2 opens with the new wallet.

*The name is who the agent is. The ring is how the key exists without being stored. The swarm only emits events.*

HITL is enrollment (`ring init`), not every restore. After init, encrypt/decrypt use the local member credential.

---

<!-- _header: 'Sponsor — World' -->

# World — proof-of-selfie (not finished)

Wanted gate: **Selfie Check on granting rehydration requests**.

- Requester is a live human, not a script
- Professional second-opinion: colleague sees only granted fields
- Nullifier binds `(appId, docHash, slotId)` — one human per slot; Alice does not learn who

**Status:** not shipped this export. Optional policy — author can skip so the Ledger demo survives sandbox.

Fail-closed when enabled: no proof → no wrap → no `SlotKeyGranted`.

---

<!-- _header: '' -->

# Close

> Redact on your machine. Authorized wallets rehydrate only the fields they're allowed to see.

- **ENS** names the contracts. Events are the database.
- **Ledger** is HITL on the request, and the ring for agent recovery.
- **World** selfie is the human gate we want on grants — still open.

No SoulVault server. No revoke-after-unwrap (READ copies exist).

https://nacmonad.github.io/soulvault/
https://github.com/nacmonad/soulvault
