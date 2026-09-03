# TODO_2 — Deferred design work (from redaction-hydration-spec v0 discussions)

**Scope decision:** the hackathon build targets the simplest loop — allowed users
fetch and decrypt the hydration bundle **in the browser** (spec §2 key topology,
§7 session-key pattern, §3 grant model). Everything below is deferred and
recorded so it isn't redesigned from scratch later. Do not build any of this for
the demo.

---

## 1. Agentic payment rail (x402)

Deferred; note that **0G is no longer a sponsor of ETHOnline 2026** — the
original 0G storage/prize lane is retired.

- x402 over HTTP, settled on Hedera through the **Blocky402 facilitator**
  (x402 v2 flow: 402 → sign → retry with `X-PAYMENT` → facilitator verifies +
  settles onchain → settlement txn ID in response header).
- **Payment ≠ authorization.** Each retrieval settles on exactly one rail; never
  double-charge. For governed slots, the x402 endpoint can require a granted
  task ID before accepting settlement.
- Payment is a **generic transfer** onchain — no application-level event
  ("payment was for docId/slotId" lives only in the HTTP exchange). Do not try
  to reconstruct task semantics from chain observation.
- x402 flow is **synchronous**: the provider *is* the resource server; payment
  verification happens inside the request handler. No listeners, no workers.
  Async job records (`jobId` + status endpoint) only if redaction jobs become
  long-running.
- Optional Hedera extra point: mirror settled payments to an **HCS topic**
  (txn ID + resource + task ID) for a verifiable payment audit trail.
- "Why x402 when a wallet can tx directly to the treasury?" — the product is
  bytes behind an HTTP endpoint; x402 makes the service consumable by any HTTP
  client with no ABI integration. The treasury rail is for the governed case,
  not metering.

## 2. Task primitive (governed rail)

**`DocumentViewTask` — pull-based state machine** (mirrors the fund-request
lifecycle; no offchain listener required for correctness):

```
Open      requester posts deposit via requestDocumentView(docId, slotIds, deadline)
Granted   provider grants (EIP-712, Ledger clear-signed offchain)
          → fee to treasury, deposit remainder refunded
Rejected  provider declines → full refund
Expired   deadline passed → anyone calls refundDocumentView(taskId)
Cancelled requester withdraws pre-grant → deposit returned
```

- Events (`DocumentViewRequested`, `DocumentViewTaskSettled`) exist for UX and
  to wake the provider's service (prompting the Ledger flow); the contract
  settles regardless. Trustlessness boundary: expiry refunds callable by anyone.
- **Open decision — escrow location:** treasury contract (trustless) vs swarm
  contract with treasury as fee collector vs org EOA fallback (an IOU, not
  escrow — document as weaker mode or drop it). Blocks the Solidity work.
- When needed: update `ISoulVaultSwarm.sol`/`ISoulVaultTreasury.sol`, spec docs,
  ABI in `swarm-contract.ts`/`treasury-contract.ts`,
  `skills/soulvault/references/events.md` (per `CLAUDE.md`).

## 3. USE-without-READ engines (compute over a field; plaintext never disclosed)

- USE revocation is **strong** (nothing ever disclosed; policy checked live per
  call) vs READ revocation which is weak against copies. Keep this asymmetry
  visible in docs/judging materials.
- **Engine A (hackathon target, deferred): TEE via Chainlink CRE Confidential
  Workflows** — `handlerInTee` receives slot key + ciphertext, decrypts inside
  the enclave, evaluates policy, returns only the result. Satisfies the
  Chainlink prize's core requirement. *Not* in the READ path — CRE cannot be a
  synchronous dependency in a browser click-flow, and READ needs zero extra
  trust.
- **Engine B (roadmap): zkSNARKs** — provider-as-prover generates proofs against
  the onchain slot commitments; no service, no enclave, secret never moves.
  **Non-obvious constraint:** circuits must bind the **epoch nonce** from day
  one or proofs outlive revocation forever. No zk sponsor this cycle → roadmap.
  (MPC: third engine, strictly more infra — footnote only.)
- Possible v1+ trust upgrade: a CRE workflow as decentralized key-release
  service (verifies onchain grant, wraps `K_i` to requester's session pubkey) —
  removes the provider from key release, adds latency.

## 4. Browser UI — current-scope notes (not deferred)

- **Backend-free principle:** presidio-web and bundle creation run client-side;
  no `POST /api/docs/redact` or equivalent — PII must never touch a server. The
  web app is a static UI + wallet + RPC reads; the chain (contract events, or
  0G for oversized blobs) is the transport.
- **Document contract on Sepolia** (spec §10): one chain for ENS discovery,
  ERC-8004 identity, World verification, and Subgraph Studio indexing. 0G
  Storage only for oversized blobs.
- **Discovery via subgraph, not ENS records:** ENS advertising of document
  activity was rejected — public, permanent records linking wallets to
  redaction activity. Browser UI scans grants/docs through the Subgraph Studio
  index instead.
- Wallet is an **authorizer, not a decryptor**: it cannot export keys, and
  MetaMask's `eth_getEncryptionPublicKey` (X25519/XSalsa20) mismatches the
  locked wire format. Consumers use a **stable, wallet-attested browser keypair**
  (IndexedDB) — wrapping happens at grant time in the author's client, since no
  server exists to wrap at fetch time. Key loss ⇒ re-attest new key ⇒ re-grant.
- Commitments/epoch-nonce deferred with the bundle-in-public-events reasoning
  (spec §3): a published salt defeats salting; commitments wait for a verifier.
- Chainlink, x402, and the task state machine are all out of the browser path.
