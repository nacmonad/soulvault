---
marp: true
theme: default
paginate: true
title: SoulVault — ETHOnline 2026
header: 'SoulVault — ETHOnline 2026'
style: |
  section {
    background: #0f172a;
    color: #e2e8f0;
    font-size: 27px;
  }
  h1 { color: #818cf8; font-size: 1.5em; }
  h2 { color: #a5b4fc; }
  strong { color: #f8fafc; }
  a { color: #818cf8; }
  code {
    color: #7dd3fc;
    background: #1e293b;
    padding: 0 6px;
    border-radius: 6px;
    font-size: 0.9em;
  }
  pre, pre code {
    background: #0b1222;
    color: #c7d2fe;
    border: 1px solid #334155;
    border-radius: 10px;
    font-size: 0.85em;
  }
  pre { padding: 14px; }
  header { color: #94a3b8; font-size: 14px; }
  footer { color: #64748b; font-size: 12px; }
  blockquote {
    color: #c7d2fe;
    border-left: 4px solid #4f46e5;
    padding-left: 16px;
  }
  table { font-size: 0.85em; }
  th { color: #a5b4fc; }
  section.lead { text-align: center; }
---

<!-- _header: '' -->
<!-- _paginate: false -->

# SoulVault

## Redact on your machine. Recover what an agent was — even after it dies.

![bg right:34% 62%](media/logo.svg)

ETHOnline 2026 · Documents · ENSv2 · Ledger · World

**G0:** Redact on your machine. Authorized wallets rehydrate only the fields they're allowed to see.

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
- Same wrap as epoch bundles / DMs — now on document slots

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

Agents can be killed — their subname is **burned** (`ROLE_UNREGISTER`) so the label is reclaimable by a successor, and memories are revived via epoch-key recovery.

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

![w:340 invert](media/LEDGER-WORDMARK-BLACK-CMYK.png)

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

# Catastrophic recovery — the Charlie story

```
v1 dies      → wallet gone, membership revoked (MemberRemoved)
v2 joins     → fresh wallet, join-request → owner approves
v2 asks      → requestEpochKey(keyName)     ★ EpochKeyRequested
Alice's ring → derives key ON-CHIP — never stored, never sent
grant DM     → ECDH-wrap to v2's pubkey → sv:epoch-grant:v1
v2 opens     → unwrap grant → fetch escrow → decrypt
             → byte-identical MEMORY_FILE.md ✓
```

- Escrow ciphertext: `soulvault:epoch-recovery:charlie…:epoch-000007`
- Public bundle carries the **registry contract address** — rehydrators don't need membership

---

# Succession — the name is the identity

1. Owner **burns** v1's name — `ROLE_UNREGISTER` at org root
2. Grants `ROLE_REGISTRAR` on the swarm subregistry → v2
3. v2 **re-registers the same label** — `charlie.ops.soulvault-ensv2.eth`
4. Resolver records point at v2's new ERC-8004 agent id

**Zero state carried over.** New wallet, same name, memories restored by the ring.

*The contract never sees a key — it sees events. Kick events trigger sweeps, manifests point at escrows, ENS anchors identity.*

---

---

# Demo — live walkthrough

<iframe src="https://www.youtube-nocookie.com/embed/yX8Il3XSTwA" width="760" height="428" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>

https://youtu.be/yX8Il3XSTwA — *ETHOnline 2026 · Soulvault Redact Rehydrate Demo*

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

> Redact on your machine. Recover what an agent was — even after it dies.

- **ENSv2 EAC** names the contracts, agents own their subnames. Events are the database.
- **Ledger** is HITL on requests — and the ring that **derives, never stores**.
- **World** selfie is the human gate we want on grants — still open.

No SoulVault server. No keys onchain. Identity survives the wallet. **BYORPC** — bring your own RPC.

🎬 Demo walkthrough: https://youtu.be/yX8Il3XSTwA
https://nacmonad.github.io/soulvault/
https://github.com/nacmonad/soulvault
