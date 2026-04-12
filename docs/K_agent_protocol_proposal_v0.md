# K_agent Protocol Proposal v0

**Status:** proposal — not part of SoulVault MVP wire protocol. Intended to sit **alongside** the existing **`K_epoch`** model documented in `protocol-v0.1.md`, `architecture.md`, and `skills/soulvault/references/crypto.md`.

**Goal:** spell out an optional **per-agent memory encryption** layer (`K_agent`), how it differs from **`K_epoch`** in **trust** and **business value**, and a **practical recovery** pattern (random `K_agent` + wrap to cold / guardian keys).

---

## 1. Two keys, two purposes

| | **`K_epoch` (existing)** | **`K_agent` (proposed)** |
| --- | --- | --- |
| **What it encrypts** | Swarm-scoped backups, swarm-encrypted group messages, and other **shared coordination** ciphertext | **Agent-private** memory archives (and optionally other agent-only blobs) |
| **Who can decrypt** | **Every approved member** with access to the current or granted historical epoch key | **Whoever holds `K_agent`** and/or keys that can **unwrap** a stored recovery blob |
| **Distribution** | Wrapped per member via **secp256k1 ECDH + AEAD** in epoch bundles; anchored by **`EpochRotated`** onchain | **Local** to agent by default; optional **recovery wrap** to **non-swarm** pubkeys |
| **Trust summary** | Trust **the swarm as a set** + **membership admin** (who rotates epochs and admits members) | Trust **custody** of `K_agent` and/or **cold/guardian** unwrap keys; **not** the whole swarm for plaintext |

MVP SoulVault is **`K_epoch`-only** for backup/message payloads: intentional **swarm-readable** coordination (`architecture.md`).

---

## 2. Why both matter (practical importance)

### `K_epoch`

- **Shared situational awareness:** any member can decrypt others’ swarm-scoped backups/messages when collaboration requires it.
- **Simple ops:** one symmetric key lineage per epoch; rotation tied to **membership changes** and **owner-escrowed** historical grants.
- **Onchain alignment:** file mappings, `EpochRotated`, and message events stay the **single coordination bus** already specified.

### `K_agent` (when enabled)

- **Confidentiality from peers:** competitor agents, untrusted swarm members, or “read everyone’s memory” policies are **out of scope** for plaintext if memories are only under `K_agent`.
- **Org-readable is opt-in:** swarm/org owner does **not** automatically get memory plaintext unless the agent **wraps recovery** to org-controlled keys (explicit trust).
- **Regulatory / brand posture:** “agent thoughts” can be modeled as **user- or operator-held secrets** with a documented recovery story, instead of default swarm-wide readability.

---

## 3. Trust model comparison

### `K_epoch` — trust you accept

1. **All current swarm members** (shared key).
2. **Former members** for ciphertext created **before** rotation that they already decrypted or stored (same practical assumption as `protocol-v0.1.md`: local copies may persist).
3. **Owner / admin** of membership: controls **who joins**, **who is removed**, and **when epochs rotate** — shapes **future** access and **historical grants**.

### `K_agent` — trust you accept

1. **Custodian of `K_agent`** on the hot/runtime path (loss = loss of decrypt unless recovery succeeds).
2. **Custodians of recovery unwrap keys** (cold wallet, guardian EOAs, or future threshold scheme) — whoever can decrypt the **recovery wrap** can recover `K_agent` and thus memories.
3. **Swarm/org** only for **metadata** (storage refs, hashes, backup triggers) unless the agent **chooses** org escrow.

**Non-goal (v0 proposal):** proving a recovery key is “not a human.” Use **threshold custody** (multisig policy, M-of-N ceremonies, Shamir shares) if **no single human** should unwrap alone — see §6.

---

## 4. Business / product use cases

### When **`K_epoch`-style swarm-readable backups** fit

- **Internal toolchains:** teams want **shared debuggability** and **handoff** between agents.
- **Fleet operations:** operator needs **any seat** to restore or inspect agent state for **SRE-style** response.
- **Research / collaboration:** multi-agent projects where **cross-reading memory** is a feature.
- **MVP velocity:** minimal key topology; aligns with current SoulVault implementation direction.

### When **`K_agent`-style private memories** fit

- **Multi-tenant / B2B swarms:** customers **should not** read each other’s agent state; operator sells **isolation**.
- **Sensitive automation:** trading, personal data, credentials-in-context — **peer readability** is unacceptable.
- **Agent “autonomy” narrative:** memories treated like **client-side secrets** with **explicit** recovery, not default swarm knowledge.
- **Compliance framing:** data minimization — only **designated** recovery parties can unwrap, auditable by **policy** (who was in the unwrap set), not by default membership.

### Hybrid (common in production)

- **Outer / manifest layer:** still use **`K_epoch`** (or plaintext metadata) for **coordination** — “a backup exists,” triggers, merkle roots — as today.
- **Inner layer:** **memory tarball** (or a dedicated subtree) encrypted with **`K_agent`**; recovery wrap stored **beside** manifest on 0G.
- **Tradeoff:** more moving parts; recovery must be **tested** like any DR path.

---

## 5. Proposed cryptographic sketch (v0)

**Generation**

- `K_agent` = **32-byte random** secret (CSPRNG).  
- **Do not** require `K_agent = HKDF(K_epoch, …)` for the privacy story — derivation from `K_epoch` would **re-introduce swarm trust** for that secret. (A **separate** derived key from `K_epoch` for **non-private** slices is still possible; keep roles explicit.)

**Backup**

- Encrypt agent-private archive with **AES-256-GCM** (or align with manifest cipher already used for `K_epoch` backups in `crypto.md`) under **`K_agent`**.
- Upload ciphertext + manifest to **0G**; record refs/hashes onchain per existing **file mapping** patterns.

**Recovery wrap (optional but recommended for DR)**

- Wrap **`K_agent`** using the **same family** as epoch key wrapping: **ephemeral secp256k1 ECDH + AES-256-GCM** (or documented HPKE profile) to **one or more recovery public keys** not controlled by the swarm.
- Store the wrap in the **manifest** or a **small sidecar** object next to the backup on 0G.
- **Rotation:** if `K_agent` rotates, emit a **new** wrap; old ciphertext remains decryptable only with **old** `K_agent` unless re-encrypted.

**Hot path**

- Runtime holds **`K_agent`** in agent key material (keyring / secure store). Loss of hot machine **without** recovery wrap + cold key ⇒ **memories not recoverable** (same as any lost symmetric key).

This proposal **does not** change MVP contract ABIs; it is an **offchain envelope + manifest convention** until implementation assigns version fields (`MESSAGE_PROTOCOL.md`-style envelope recommendations apply by analogy).

---

## 6. Multisig and “recovery key” reality

- **EOA recovery pubkey:** straightforward ECDH wrap target.
- **Smart contract wallet / multisig `address`:** **not** a single secp256k1 pubkey — naive “wrap to Safe address” does not work without **extra machinery** (e.g. wrap to **each guardian’s** EOA pubkey, or use **secret sharing** of `K_agent`, or a **dedicated recovery EOA** held in joint custody).

v0 recommendation: document **one cold EOA** or **per-guardian wraps**; defer **threshold ECDH** to a later revision.

---

## 7. Relation to owner escrow (existing `K_epoch` story)

SoulVault already uses **owner escrow** inside **epoch bundles** so the **owner** can recover historical **`K_epoch`** values (`crypto.md`, `glossary.md`).

- **That escrow is about epoch keys**, not about optional **`K_agent`**.
- If **org-readable break-glass** is desired for **private memories**, it is an **explicit product choice:** include an **org pubkey** in the **`K_agent` recovery wrap set**. Otherwise the **org** sees only **ciphertext + coordination metadata**, same as other swarm members without `K_agent`.

---

## 8. Open questions (for v1+)

- [ ] Manifest schema version field and cipher id for `K_agent` vs `K_epoch` blobs.
- [ ] Whether **double encryption** (outer `K_epoch`, inner `K_agent`) is mandatory or optional.
- [ ] CLI UX: bootstrap, rotate `K_agent`, re-wrap, disaster recovery wizard.
- [ ] Interaction with **historical key grants** (epoch) when **memory** is `K_agent`-only.
- [ ] ERC-8004 / public URI: **never** leak `K_agent` or recovery material in `agentURI`.

---

## 9. Design intuition: shared pool vs private agent, and deliberate teaching

### `K_epoch` as a shared medium

Treating **`K_epoch`** as a **swarm-readable** key defines a **shared memory substrate**: any member with the current or historically granted epoch key can decrypt the same backup/message ciphertext. That enables **collaboration** (common situational awareness), **handoff** when one agent stops (another member can help rehydrate state), and **horizontal transfer** of operational context—by analogy to **bacterial transduction**, where genetic material moves through a **pool** the group can draw from rather than only vertical inheritance.

**Recovery by “asking another member”** is **social and temporal**: it works if someone still holds the relevant key and agrees to help, and it is bounded by **membership and epoch policy** (e.g. after **kick + rekey**, former members should not receive **new** keys; **old** ciphertext may still be decryptable by anyone who retained an old key—same practical assumption as `protocol-v0.1.md`).

### `K_agent` when peers or org are not trusted with plaintext

**`K_agent`** is appropriate when agents must treat **other swarm members** or the **org** as **not entitled to raw memory**—**multi-tenant**, **adversarial**, or **trust-minimized** deployments. Cryptography does not remove all trust (custody, chain semantics, infra still matter), but it **denies by default** the **swarm-wide readability** that `K_epoch` intentionally provides.

### Skill transfer without shared `K_epoch`: messages and deliberate teaching

Agents using **`K_agent`** for private archives can still **transfer skills** through the **message protocol** (`MESSAGE_PROTOCOL.md`): **public**, **swarm-encrypted**, or **DM** payloads carrying **prompts, distilled policies, tool schemas, curricula, attestations**, etc. That transfer is **consensual export**—the sender chooses what to send—not **silent exfiltration** of another agent’s private backup.

To make teaching **cryptographically attributable** and **binding** (recipient can verify **who** attested to a lesson and **what** was signed, independent of inferring intent from chain metadata alone), prefer **EIP-191** (`personal_sign`–style prefixed hashing) or **EIP-712** typed structured data for the **teaching payload** (or a hash commitment to it) before encryption where applicable. **Sign-then-encrypt** (or sign a domain-separated struct that includes `topic` / `seq` / `epoch` to limit replay) matches the “**deliberate teaching**” model: the exporting agent **cryptographically endorses** what they are willing to share.

---

## 10. References (repo)

- `docs/protocol-v0.1.md` — MVP principles, `K_epoch` sharing.
- `docs/architecture.md` — swarm-readable model; pointer to this proposal.
- `skills/soulvault/references/crypto.md` — `K_epoch`, wrapping, backup AES-GCM, manifests.
- `contracts/MESSAGE_PROTOCOL.md` — message audience inference; AAD recommendations.
