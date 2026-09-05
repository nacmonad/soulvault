# Redaction + Rehydration Spec v0

**Status:** proposal — not implemented. The redaction/rehydration layer has no code
in `packages/`, `apps/`, or `contracts/` yet; the prior sketches live in
`README.md` (§Roadmap) and `apps/web/brand/context.md` (Product A). This doc is the
design source of truth going forward.

> **Current build scope (narrowed):** the minimum loop, **fully backend-free** —
> presidio-web + bundle creation in the author's browser (§2), grants as
> contract events carrying wrapped keys (§3), chain events / 0G as transport
> (§4), and fetch-and-decrypt in the consumer's browser (§7). The agentic x402
> payment rail, the `DocumentViewTask` state machine, commitments, and the USE
> engines are **deferred** — captured in `TODO_2.md` (§3b, §5–6 describe
> deferred designs).

> **0G is no longer a sponsor of ETHOnline 2026.** The original proposal stored
> hydration bundles on 0G Storage and pitched 0G as the hackathon lane. That is
> retired. The crypto core, contract model, and ENS/ERC-8004 identity lane are
> unaffected; only the ciphertext *storage* and *distribution* decisions change
> (see §4).

---

## 1. Problem and product statement

A document provider redacts sensitive fields **locally** (presidio-web) and
distributes the redacted artifact over ordinary channels — email, Slack, whatever.
The artifact carries no sensitive plaintext at all, so the channel is no longer
sensitive.

Authorized parties recover the removed fields selectively:

- **READ** — disclose the plaintext of specific fields to a specific wallet.
- **USE** — compute over a field and return only the result; the plaintext is
  never disclosed to the requester (and therefore never leaves provider control,
  which is what makes revocation enforceable rather than honor-system).

This is a paid, metered service: per-slot pricing is natural because every slot
carries its own key.

## 2. Key topology (constrained by `packages/protocol`)

All primitives come from `packages/protocol/src/crypto.ts` (noble libraries,
isomorphic — no Node built-ins, no Buffer). Wire formats must respect the compat
contract documented in that file; new formats require a protocol version bump and
updated `crypto-compat.test.ts`.

Per document:

- The provider runs presidio-web locally, producing N **slots** (removed fields).
- Each slot `i` gets a fresh symmetric key `K_i` (AES-256-GCM).
  - `ciphertext_i = AES-256-GCM(K_i, plaintext_i, aad = {docHash, slotId})`
  - The slot commitments and secret salt from earlier drafts are **dropped for
    v0**: with bundles published in public event data, a published salt defeats
    salting, and no verifier exists yet (deferred to the USE/zk phase, §3b).
- The redacted artifact carries a **self-describing manifest**, signed by the
  author: `{docHash, author, slots[]: {slotId, entityType, occurrences,
  ciphertext}}` with an EIP-712 signature over `{docHash, slots[]}`. The file is
  the registry: Charlie hashes the dropped file, verifies the author signature,
  and has everything needed to resolve slots — no central docId allocation, no
  lookup service.
- `docId` (in the deferred sections below) refers to
  **docHash = SHA-256 of the redacted artifact bytes** (deterministic from the
  file); deferred-event schemas may still show `docId` in their signatures.
- **The addressable bundle is the wrap set**, constructed per recipient at
  grant time:
  `{docHash, recipient, wraps[]: {slotId, wrappedKey, ephemeralPublicKey,
  nonce, expiresAt}}`
  Each `wraps[]` entry is exactly a `SecpWrappedKey` (see
  `packages/protocol/src/crypto.ts`) plus the slot reference. This is the
  "key-by-key addressing" property: the bundle's atomic unit is the field, not
  the document.

## 3. Grant model

A grant is `(docHash, slotId, recipient, expiry, mode ∈ {READ, USE})`.

**v0 (narrowed scope):** grants are **contract events**:
`SlotKeyGranted(docHash, slotId, recipient, wrappedKey, expiry)` — the grant
event *is* the key delivery. The publish and grant txs are authenticated by the
author's wallet signature (the tx `from`), so the onchain record already carries
"Alice said so"; the artifact's embedded author signature (§2) extends that
tamper-evidence to the file itself, the one input that travels over
unauthenticated channels. Revocation is a `SlotRevoked(docHash, slotId,
recipient)` event that consumers' clients honor when filtering.

**Optional policy tier — verified-human grants (World ID):** a document may
declare a `verified-human` policy instead of an explicit allowlist. The requester
presents a World ID proof with a **nullifier scoped to `hash(appId, docHash,
slotId)`**, verified against World's onchain verifier (or by Alice's client).
Nullifier uniqueness gives one grant per human — sybil-resistant, privacy
preserving (Alice never learns who), and still backend-free. Risk-tiering
then falls out: allowlist slots (no credential) < Selfie Check (low-friction
biometric) < World ID proof (strong) < governed/express-grant (Ledger-signed).

**Deferred to the USE/zk phase:** per-document root commitments, salted slot
commitments, and the epoch nonce. Reason: commitments are only
dictionary-attack-resistant while the salt stays secret; once the whole bundle
lives in public event data, a published salt defeats the salting. Commitments
earn their place when there is a verifier (USE engines, §3b) — not before.

**Honest revocation semantics:**

| Mode | Revocation strength |
|------|--------------------|
| READ | Weak against copies — once a wallet unwrapped the plaintext, revocation only stops *future* wrapping. State this plainly in docs and judging materials. |
| USE | Strong — nothing was ever disclosed; policy is checked live per call, and rotating the epoch nonce kills all stale computation rights. |

## 3b. USE engines

USE-without-READ is the product category; the engine is pluggable.

### Engine A (hackathon target): TEE via Chainlink CRE Confidential Workflows

- A CRE workflow with `handlerInTee` receives the slot key + ciphertext (or the
  wrapped key + recipient ephemeral pubkey), decrypts **inside the enclave**,
  evaluates the policy (range check, match, threshold), and returns only the
  result.
- Fits the Chainlink prize requirement verbatim: confidential portion processes a
  sensitive input inside the enclave and is load-bearing, not a placeholder.
- Trust base: hardware vendor + attestation. Compute is cheap and arbitrary
  (plain JS).

### Engine B (roadmap): zkSNARKs — "trustless USE"

- The **provider is the natural prover**: it already holds the plaintext and
  publishes per-slot commitments. It generates a proof
  "I know x with commitment C_i (and current epoch nonce e) such that policy P(x)
  holds"; anyone verifies against the onchain commitment.
- No hydration service, no TEE, no key delivery — the secret never moves.
- **Non-obvious design constraint:** ZK proofs are static artifacts. Every circuit
  must bind the **epoch nonce** from day one, or proofs outlive revocation
  forever.
- Cost: real circuit engineering. No zk sponsor exists in the ETHOnline 2026
  prize list, so this is roadmap, not hackathon scope.
- (Footnote: MPC is a third engine — secret-sharing the field across parties —
  strictly more infrastructure for this use case; recorded for completeness.)

## 4. Storage and distribution — the chain is the transport

**General principle: the redaction path has no backend.** presidio-web runs in
the author's browser precisely so PII never touches a server; bundle creation
(keygen, encryption, artifact assembly) is client-side via `@soulvault/protocol`.
Avoid SoulVault backend calls as a design default.

The chain carries everything:

- **Primary: contract events as transport.** Slot ciphertexts are small (PII
  fields — tens of bytes), so `DocumentPublished(docHash, slots[]: {slotId, aad,
  ciphertext})` fits in event logs, and wrapped keys ride `SlotKeyGranted`
  events (§3). Consumers read events over RPC — stateless, no server-held
  state, works from browser or CLI.
- **Large artifacts (whole-document blobs): 0G Storage again.** 0G is not a
  sponsor, but the integration already exists and works
  (`packages/node/src/0g.ts`); use it when a bundle exceeds sane event size,
  with only the 0G root hash riding in the event.
- Plaintext never onchain, never on a server; ciphertext only.

## 5. Payment and authorization — two rails, one service

Settlement and authorization are orthogonal. A given retrieval settles on exactly
one payment rail, and its authorization is either the payment itself (agentic
rail) or an onchain grant (governed rail). Never double-charge a request on both.

| Rail | Settlement | Authorization | Audience |
|------|-----------|---------------|----------|
| **Agentic** | x402 over HTTP (Hedera, Blocky402 facilitator). Payment *is* the anti-spam — no deposit, no treasury. | Payment itself (provider policy) | Agents, machine-speed |
| **Governed** | Deposit escrowed onchain; settled by the `DocumentViewTask` state machine (§5b) | Onchain grant + Ledger clear-signed EIP-712 | High-sensitivity docs, humans + agents |

**Why x402 when a wallet could tx directly to the treasury?** The delivered
product is bytes behind an HTTP endpoint (wrapped key + ciphertext reference);
x402 is the standardized HTTP-native way to attach pricing disclosure, payment,
and receipt to that response, consumable by any agent without integrating the
contract ABI. The treasury rail exists for the governed, human-approved case —
it is not the metering rail.

**Composition:** for high-value slots, the x402 endpoint can *require* a granted
task ID (onchain check) before accepting settlement — payment via x402,
authorization via the contract. Each rail does what it is good at.

### 5b. DocumentViewTask — the job primitive

The governed rail is a **pull-based task state machine**, mirroring the existing
fund-request lifecycle. No offchain event listener is required for correctness:

```
Open      requester posts deposit via requestDocumentView(docId, slotIds, deadline)
Granted   provider grants (EIP-712, optionally Ledger clear-signed offchain)
          → fee to treasury, deposit remainder refunded to requester
Rejected  provider declines → full refund
Expired   deadline passed → anyone calls refundDocumentView(taskId)
Cancelled requester withdraws pre-grant → deposit returned
```

- Expiry refunds are callable by anyone — the contract settles without any
  worker showing up. That is the trustlessness boundary.
- Events (`DocumentViewRequested`, `DocumentViewTaskSettled`) exist for UX
  (`swarm events watch`) and to wake the provider's hydration service, which
  then triggers the Ledger signing flow. The provider's service is the natural
  task worker; correctness never depends on it.
- **Escrow location:** deposit lives in the treasury contract when the org has
  one; if not, fallback to the org address is a **weaker, trust-based mode**
  (an EOA escrow is an IOU, not escrow) — document it as such, or prefer
  holding escrow in the swarm contract with the treasury as fee collector.

Discovery: org ENS text record advertising the service endpoint (e.g. a
`soulvault.hydration` URL record) + the provider's ERC-8004 agent identity.
ENSIP-25/26 records already shipped in this repo cover the agent side.

## 6. x402 service surface (v0)

Provider-hosted HTTP service (thin handlers; business logic stays in
`packages/node/`, consistent with the repo's thin-handler rule):

- `GET /manifest` — service + pricing manifest (x402 well-known style)
- `POST /docs/:docId/slots/:slotId/read` → `402` with payment requirements; after
  settlement returns the slot key wrapped to the requester's ephemeral pubkey +
  ciphertext reference. If the slot is governed (§5b), the 402 also demands a
  granted task ID and verifies it onchain before releasing.
- `POST /docs/:docId/slots/:slotId/use` → `402`; after settlement dispatches to
  the USE engine and returns only the result

The READ endpoint's response format reuses the epoch-bundle/DM wrap encoding so
browser and CLI hydration share one code path in `packages/protocol`.

## 7. Browser hydration — the attested recipient-key pattern

Wallets do not export private keys, so the browser cannot do ECDH with the wallet
key — and MetaMask's `eth_getEncryptionPublicKey` (X25519/XSalsa20) mismatches
the locked wire format (secp256k1 ECDH + AES-256-GCM). The wallet is therefore an
**authorizer**, not a decryptor.

Because there is **no backend** to wrap keys at fetch time (§4), wrapping happens
at **grant time** in the author's client — so the consumer uses a **stable,
wallet-attested browser keypair**, not an ephemeral session key:

1. **Charlie's browser** generates a secp256k1 keypair via `@soulvault/protocol`
   (persistent in IndexedDB) and his wallet signs an EIP-712 attestation binding
   the pubkey to his address: `{recipientPubkey, address, expiry}`.
2. **Alice's client** (browser or CLI agent — identical code paths) verifies the
   attestation, wraps `K_i` to Charlie's pubkey with the standard
   epoch-bundle/DM encoding, and posts the grant event
   `SlotKeyGranted(docHash, slotId, charlie, wrappedKey, expiry)`.
3. **Charlie's browser** filters events for his pubkey, unwraps with his private
   key, decrypts the slot ciphertext (AAD-bound to docHash/slotId), splices the
   plaintext into the redacted artifact. Plaintext exists only in his tab.

Key-loss story: lost browser storage = lost keypair = grant re-issued wrapped to
the newly attested key. Revocation (§3) stops future unwraps by honoring
`SlotRevoked` during filtering; already-decrypted plaintext is unrecoverable —
the known READ weakness.

**End-to-end flow summary (backend-free):**

- *Alice, client-side only:* presidio-web detects slots → fresh `K_i` per slot →
  AES-256-GCM ciphertexts → redacted artifact to Charlie via any channel →
  publish ciphertexts (`DocumentPublished` event, or 0G blob + root hash in the
  event) → grant = wrap + `SlotKeyGranted` event.
- *Charlie, client-side only:* receive redacted artifact → attest browser
  keypair with wallet → read chain events → unwrap → decrypt → render.

No SoulVault server participates in the redaction or hydration path; the web app
is effectively a static UI + wallet + RPC reads. The CLI agent path reuses the
identical wrap encoding — only the signer differs. Chainlink is **not** in this
path: CRE's home is the USE engine (§3b); the READ path is browser-local end to
end.

## 8. Onchain vs offchain summary

| Artifact | Where |
|----------|-------|
| Redacted artifact | Ordinary channels (email/Slack/HTTP) |
| Hydration bundle (ciphertext) | Provider x402 service (hackathon); durable store (roadmap) |
| Slot commitments, epoch nonce, grant/revoke events | SoulVault-style contract (references + commitments only) |
| Deposit escrow | Treasury contract pattern |
| Audit trail | Contract events; optional HCS mirror (roadmap) |
| PII / plaintext / unsalted hashes | **Never onchain, never in logs** |

## 9. Testing posture

- Crypto primitives + wire formats: `packages/protocol` compat tests (both
  directions against the node:crypto reference), per `CLAUDE.md`.
- Ledger human-in-the-loop path: **Speculos** emulator suite
  (`pnpm test:speculos`, see `docs/clear-signing-runbook.md`) + real-device suite
  for the demo recording.
- x402 path: live paid request end-to-end on Hedera testnet via Blocky402
  (hard requirement of the Hedera prize; verify facilitator docs first — it is
  the main schedule risk).
- USE path: CRE Confidential Workflow simulation via CRE CLI, evidence retained
  per the Chainlink prize requirements.

## 10. Hackathon mapping (ETHOnline 2026)

Sponsors on the prizes page: The Graph, Hedera, Arc, World, 1inch, ENS, Uniswap
Foundation, Ledger, Privy, Bazantic, Chainlink. **0G is absent.** ETHGlobal
allows only **three prize selections per submission** — final pick:

1. **Ledger** (Continuity $1,500 / AI Agents $3,500): human-in-the-loop grant
   signing with clear-signing; chain-agnostic, works with the Sepolia document
   contract unchanged. The $3,500 stream requires the Ledger Agent Stack / Key
   Ring CLI — verify scope at developers.ledger.com/ethonline before committing.
2. **World** (Selfie Check / AgentKit, $3,500 each): verified-human grant
   policy tier with scoped nullifiers (§3). Requires World ID Sandbox App for
   remote testing plus a feedback document. Keep it a policy tier, never a hard
   requirement, so the Ledger demo survives sandbox issues.
3. **The Graph** (Continuity AI track): a Subgraph Studio subgraph indexing
   `DocumentPublished` / `SlotKeyGranted` / `SlotRevoked` — turns public event
   transport into one GraphQL query for the browser UI ("docs granting slot-2
   to verified humans, unexpired") and gives agents a live structured source.
   Requires the document contract on a Studio-supported chain → **deploy the
   document contract on Sepolia** (see below).

**Chain placement decision:** the document contract lives on **Sepolia**, not
0G. Everything in the narrowed scope is already Ethereum-side — ENS discovery,
ERC-8004 identity, World ID verifier, and now Subgraph Studio indexing — so one
chain makes all three picks cheaper and collapses the two-lane demo into one.
0G Storage keeps its one remaining job (oversized blobs, root hash in the
event). The 0G ops lane stays valid for the swarm/continuity product; this is
only about where the document contract lives.

**Deliberately not picked:**

- **ENSv2** ($4,500/$500): advertising document redactions on ENS records is
  the wrong shape — records are public and permanent, linking a wallet's name
  to its redaction activity forever. Discovery belongs in the subgraph (§10.3),
  which is queryable without creating identity-linked trails. ENS remains
  optional naming infrastructure, not a prize target.
- **Hedera** (x402), **Chainlink** (USE), **Bazantic** (recipes/gateways):
  re-enter if/when x402 or USE un-defer (see `TODO_2.md`).
- **Arc, 1inch, Uniswap Foundation, Privy**: no fit — Privy in particular would
  make a managed backend load-bearing, against the backend-free principle.
