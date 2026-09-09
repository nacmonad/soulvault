# Documents → Redact

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

Author path at `/dashboard/documents/redact` (and redirect `/dashboard/documents`
here).

1. Paste text or upload a `.txt` (structured text only; no PDF/DOCX this event).
2. Run `PresidioWorkerClient.analyze` in a dedicated worker from
   `@soulvault/presidio-adapter`. Pattern/checksum recognizers run immediately;
   do not block the UI thread.
3. Present reviewable findings (entity type, offsets, value). Author accepts or
   rejects each occurrence. Only accepted spans enter encryption.
4. Call `redactAndEncryptDocument`. Show the redacted artifact (stable slot
   markers) beside the original.
5. Download the public JSON bundle via `serializePublicDocumentBundle` (artifact
   + encrypted slots, **no** `slotKeys`).
6. Connected author publishes the integrity anchor:
   `DocumentPublished(docHash, author, slotIds)` on the configured document
   registry. `docHash` is the protocol document id.
7. Keep `slotKeys` in memory (or wallet-scoped session storage) for the Grants
   tab in the next ticket. Never log them, never put them in the bundle.

Stale worker results must not replace newer analysis (`requestId` already
handled by the adapter).

## Acceptance criteria

- [ ] Analyzing synthetic text yields reviewable findings without a backend.
- [ ] Rejected findings do not appear as slots in the artifact.
- [ ] Public bundle JSON contains none of the removed plaintext and no slot
      keys. A test scans the serialized bundle and captured logs.
- [ ] Repeated equivalent values share one `slotId` and survive reconstruction
      with every key (protocol already does this; UI must not re-id slots).
- [ ] Publish from the connected wallet as `author`. Registry event
      `slotIds` match the artifact. Wrong wallet cannot publish under someone
      else’s identity (contract rule; UI should disable publish when
      disconnected).
- [ ] `docHash` displayed in the UI equals `artifact.documentId` and the
      on-chain `DocumentPublished.docHash`.
- [ ] After publish, `useDocumentEvents` shows the new document without a
      manual full-page reload if live watching is on.
- [ ] Typecheck + `build:export` green. Add `@soulvault/presidio-adapter` to
      `apps/web` dependencies and `transpilePackages` if needed.

## Blocked by

- Dashboard chrome (shell + events provider)

## Implementation notes

- Follow `packages/presidio-adapter` and the #8 notes: no React inside the
  adapter; do not import the demo’s plaintext vault.
- Synthetic fixture text only in tests (the Alice/Charlie/Mallory strings from
  the #12 integration test are the canonical source).
- Overflow/located slots: if the author pastes a large field, the protocol
  already chooses inline vs locator. The UI does not need a separate overflow
  control in v0; fail closed on unresolved locators.
- Do not grant in this ticket. CTA at the bottom: “Continue to Grants” linking
  to `/dashboard/documents/grants` with the in-session document selected.
