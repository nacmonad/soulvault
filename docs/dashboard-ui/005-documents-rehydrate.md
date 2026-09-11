# Documents → Rehydrate

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

Consumer path at `/dashboard/documents/rehydrate`. This is the judging surface.

1. Connect wallet (already in the shell). Generate or load a browser-local
   rehydration key (`loadOrCreateRehydrationKey` + `localStorage` adapter).
   Sign the EIP-712 attestation with the connected wallet (Ledger clear-sign
   when connector is ledger).
2. Upload the public JSON bundle (`parsePublicDocumentBundle`).
3. Verify integrity: compute/read `artifact.documentId` and require it to
   equal on-chain `DocumentPublished.docHash` for that document. Mismatch
   fails closed *before* unwrap. Also check `slotIds` cover the artifact.
4. Resolve grants for this wallet via `useDocumentEvents({ recipient })` /
   `resolveGrants(docHash, recipient)`.
5. Render the redacted content with stable markers. Each granted slot is a
   toggle (hidden marker ↔ plaintext). Ungranted slots cannot be toggled.
   Default: all hidden, so the judge sees redaction first.
6. Mallory (wallet with no grants) sees only markers; unwrap errors stay
   typed (`UNAUTHORIZED_RECIPIENT`) with no plaintext leak in the message.
7. **On-chain request:** `requestRehydration(docHash, pubkey, selfieProof)`.
   If the published document has `selfieRequired`, Charlie runs the IDKit
   **browser** widget and the proof rides the request event (ticket 023).
   Unwrap of a delivered grant is **not** gated by Selfie Check.
   Ledger clear-sign of the rehydration-key attestation still applies when
   the consumer is on a Ledger session.

Export Charlie’s attestation JSON so Alice can paste it on Grants.

## Acceptance criteria

- [ ] Upload + `docHash` match against the registry is required; a tampered
      bundle (wrong id or swapped slot ciphertext) never hydrates.
- [ ] Charlie, with delivered grants, can toggle exactly those slots. Partial
      grants leave other markers redacted (`rehydrateGrantedDocument` /
      `allowPartial`).
- [ ] Mallory’s wallet produces no plaintext, including in errors and logs.
- [ ] Toggling a granted slot off returns the marker; it does not keep
      plaintext in the DOM after hide (replace text node / unmount).
- [ ] When the published document has `selfieRequired`, Request rehydration
      is blocked until the IDKit widget returns a Selfie Check proof. Unwrap
      of already-granted slots does not ask again. Unflagged documents work
      without World.
- [ ] Ledger consumer: attestation is clear-signed through the existing DMK
      session; Speculos proof acceptable for CI.
- [ ] Copy states that a delivered READ grant is permanent. No revoke UI.
- [ ] Typecheck + `build:export` green. Alice/Charlie/Mallory can be walked
      in one browser session with two wallet connections (or two browsers).

## Blocked by

- Documents → Grants

## Implementation notes

- Headless proof already lives in
  `packages/node/src/__integration__/document-acceptance-scenario.integration.test.ts`.
  This ticket is that scenario in the dashboard, not a new protocol.
- `rehydrateGrantedDocument` throws if *no* grants match; for a mixed
  Charlie (some slots granted) it hydrates the subset. UI should call it
  (or unwrap per slot on toggle) and never pass Mallory a key.
- World Selfie Check moved to ticket 023 (proof on the request, verify on
  Grants). This tab only *collects* the proof when `selfieRequired` is set.
  Keep protocol free of World types. Until 023 lands, Request rehydration
  stays the two-arg form and ticket 006 exercises Ledger only.
- Do not fetch ciphertexts from events; ciphertexts live in the uploaded
  bundle. Events are the integrity anchor + wrap transport only (spec §3–§4).
