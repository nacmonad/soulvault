# Documents → Grants

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

Author path at `/dashboard/documents/grants`.

1. Select a document this wallet published (`reduceDocumentState` filtered by
   `author === connectedAddress`), or continue from the in-session redact
   result (needs `slotKeys` still in memory).
2. List slots (`slotId`, entity type, marker, occurrence count). Author picks a
   subset.
3. Recipient: paste a wallet address. Optionally paste / fetch that recipient’s
   EIP-712 rehydration-key attestation (`buildRehydrationKeyTypedData` /
   `SignedRehydrationKeyAttestation`).
4. `createSlotKeyGrants` verifies the attestation (chain, registry domain,
   wallet, key, expiry) then wraps selected slot keys to the attested
   rehydration public key.
5. Submit `SlotKeyGranted` events (one per slot) from the author wallet.
   The wrap on the event is the protocol `SecpWrappedKey`. Last grant wins per
   `(docHash, slotId)` for that recipient.
6. Show delivered grants for the selected document from the event cache. Copy
   must state plainly: a delivered READ grant is a permanent capability — no
   revoke button.

Ledger: if the author connected via Ledger, the grant tx is clear-signed
through the existing DMK session. Injected wallet uses `eth_sendTransaction`
/ the same viem path. Do not invent a second signer stack.

## Acceptance criteria

- [ ] Only the publishing author can enable the grant action (UI + contract).
- [ ] Invalid, expired, wrong-chain, wrong-domain, or wrong-wallet attestation
      fails closed with the protocol typed error, no event sent.
- [ ] Valid grant appears in `resolveActiveGrants` for the recipient; wrap
      fields match `@soulvault/protocol` wire types (no re-defined wrap).
- [ ] Ungranted slots for that recipient remain absent from `activeGrants`.
- [ ] UI never prints raw slot keys or wrap private material. Event log may
      show `slotId`, recipient, tx hash.
- [ ] No revoke/expiry control exists. Copy does not claim erasure.
- [ ] Ledger-connected author can sign the grant tx through the existing
      session (Speculos path acceptable for CI).
- [ ] Typecheck + `build:export` green.

## Blocked by

- Documents → Redact (in-session `slotKeys` + published `docHash`)

## Implementation notes

- Grant creation without in-session `slotKeys` cannot wrap. If the author
  reloads, they must re-redact or we persist keys in sessionStorage keyed by
  `docHash` for this browser only. Document that limitation; do not put keys
  on chain beyond the wrapped grant event.
- Recipient attestation in v0 can be pasted JSON. A later polish can have
  Charlie’s browser export it from the Rehydrate tab.
- World Selfie Check is **not** on this tab. It gates Charlie’s rehydrate, not
  Alice’s grant, unless a slot policy says otherwise — v0 has no on-chain
  selfie policy field. Keep World on ticket 005.
