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
7. **Gates** (fail closed if the gate is configured and not satisfied):
   - World Selfie Check before the first successful unwrap.
   - Ledger clear-sign of the rehydration-key attestation when the consumer
     is on a Ledger session (already required for attestation). High-stakes
     copy can require Ledger even if an injected wallet is present.

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
- [ ] World Selfie Check: when the gate is on, hydration is blocked until a
      valid selfie credential for this app/doc/slot scope is presented. When
      the gate is off (dev), the rest of the flow still works.
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
- World integration is the ETHOnline gate on this page. Keep protocol free
  of World types. If the World app id / verifier is unset, show a config
  error rather than skipping silently in production builds.
- Do not fetch ciphertexts from events; ciphertexts live in the uploaded
  bundle. Events are the integrity anchor + wrap transport only (spec §3–§4).
