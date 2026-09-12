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
5. Submit `SlotKeyGranted` events from the author wallet — all selected slots
   in **one batch tx** via `grantSlotKeys` when the deployed registry supports
   it (the UI simulates the batch call first and falls back to one tx per
   slot on registries deployed before the batch function existed; the event
   format is identical either way). The wrap on the event is the protocol
   `SecpWrappedKey`. Last grant wins per `(docHash, slotId)` for that recipient.
6. Show delivered grants for the selected document from the event cache. Copy
   must state plainly: a delivered READ grant is a permanent capability — no
   revoke button.
7. Offer **Download bundle** once the document is published: the author (or
   anyone holding the artifact) saves the public JSON bundle (and the
   redacted text) and hands both to a consumer, who loads them into the
   Rehydrate UI. The download contains no slot keys and no plaintext.

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
- [ ] Published documents offer a bundle download (public JSON + redacted
      text) containing no slot keys and no plaintext; the downloaded files
      load into the Rehydrate UI unchanged.
- [ ] Ledger-connected author can sign the grant tx through the existing
      session (Speculos path acceptable for CI).
- [ ] Typecheck + `build:export` green.

## Blocked by

- Documents → Redact (in-session `slotKeys` + published `docHash`)

## Implementation notes

- Persistence model (decided): grants persist on-chain — `SlotKeyGranted`
  carries the protocol wrap, so a delivered grant never depends on
  author-side storage. Raw `slotKeys` live in localStorage under
  `soulvault.document.*` (per-browser-profile, survive reloads; sessionStorage
  is still read as a fallback from the earlier v0). Keys are never uploaded
  anywhere. Consequence: granting requires running Redact in the same
  browser profile; a *new* browser profile must re-run redact. Do not put
  keys on chain beyond the wrapped grant event.
- The public JSON bundle is downloadable from this tab (step 7). Download is
  the transport for Rehydrate inputs; no API route, no server storage.
- Recipient attestation in v0 can be pasted JSON. A later polish can have
  Charlie’s browser export it from the Rehydrate tab.
- World Selfie Check is **not** on this tab. It gates Charlie’s rehydrate, not
  Alice’s grant, unless a slot policy says otherwise — v0 has no on-chain
  selfie policy field. Keep World on ticket 005.
