# Documents → Redact

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

Author path at `/dashboard/documents/redact` (and redirect `/dashboard/documents`
here).

**Programmatic source of truth:**
[`nacmonad/presidio-web-demo`](https://github.com/nacmonad/presidio-web-demo)
(`src/app/demo/page.tsx`, `src/workers/analyzer.worker.ts`,
`src/lib/semantic-occurrences.ts`, `src/lib/demo-vault.ts` for
`normalizeEntityValue` / `indexFindings` only).

**Not the source of truth:** the demo’s layout, brand, statusbar, GLiNER
marketing card, four-panel chrome, or vault panel. SoulVault uses
`apps/web/brand/identity.md`. Do not import demo CSS or `BrandMark`.

The motor is already ported to `@soulvault/presidio-adapter` (see that package
README). The dashboard **calls the adapter**; it does not reimplement
`AnalyzerEngine` in a page component.

### Motor to follow (demo → adapter → UI)

| Demo | Adapter | Dashboard must |
|---|---|---|
| `new Worker(new URL(..., import.meta.url), { type: "module" })` | `@soulvault/presidio-adapter/worker` | Same construction; pass the worker to `PresidioWorkerClient` |
| `AnalyzerEngine` + Iban / Phone / CreditCard / Email recognizers | `analyzeText` | Do not fork a second registry in `apps/web` |
| Pattern/checksum immediate; GLiNER optional and lazy | `semanticFindings?` on `analyze` | Patterns on every scan. GLiNER off by default; if enabled later, caller-controlled and never on the UI thread |
| Monotonic `requestId`; drop stale `result` | `PresidioWorkerClient` | Ignore stale scans when the author edits and re-scans |
| `analyzedText.current = text` before postMessage | — | Slice findings against the scanned snapshot, not later textarea edits |
| `mergeFindings`: validated Presidio wins overlap | `mergeFindings` | Do not re-merge in the page |
| `expandSemanticOccurrences` after GLiNER | not in adapter yet | If GLiNER is wired, expand in the adapter (not the page) before `indexFindings` |
| `normalizeEntityValue` (phone digits, email domain) + stable id per `(entityType, normalizedValue)` | `indexFindings` → `slotId` | Use adapter `slotId`. Do **not** use demo `sv_*` vault ids as encryption identity |
| Replace spans high offset → low | `redactAndEncryptDocument` | Do not hand-roll string splice in the page |
| File `accept=".txt,.md,.json,.csv,text/*"` | — | Same accept list. No PDF/DOCX |
| Text never leaves the browser | worker errors must not include source text | No analytics, no upload of plaintext |

### Product delta vs the current demo UI

The demo currently redacts **every** finding into `{{vaultId}}` and keeps
plaintext in an in-memory vault (`demo-vault.ts`). SoulVault must not.

1. Show reviewable findings (`findingId`, `slotId`, entity type, offsets,
   value, recognizer, score). Author accepts or rejects per **occurrence**.
2. Only `acceptedFindingIds` go to `redactAcceptedFindings`.
3. Public bundle is `serializePublicDocumentBundle` (artifact + encrypted
   slots, **no** `slotKeys`, **no** `originalValue`).
4. `slotKeys` stay in memory (or wallet-scoped sessionStorage) for Grants.
   Never log them.

Then:

5. Show protocol markers (`{{sv:...}}` from the artifact) beside the source
   snapshot — that is the encrypted artifact, not the demo vault tokens.
6. Connected author publishes `DocumentPublished(docHash, author, slotIds)`.
   `docHash === artifact.documentId`.
7. CTA: “Continue to Grants” with the in-session document selected.

## Acceptance criteria

- [ ] Worker is a dedicated module worker from
      `@soulvault/presidio-adapter/worker`, constructed like the demo
      (`import.meta.url`, `{ type: "module" }`). Analysis does not run on the
      UI thread.
- [ ] Recognizer set is the adapter’s (Iban, Phone, CreditCard, Email) — the
      same set as the demo worker. No page-local `AnalyzerEngine`.
- [ ] Scanning synthetic text (reuse #12 Alice fixture) yields reviewable
      findings with stable `slotId` for repeated normalized values and distinct
      `findingId` per occurrence.
- [ ] Stale `requestId` results are dropped; a second scan while the first is
      in flight does not paint old offsets onto new text.
- [ ] Findings are sliced from the **scanned** text snapshot, not from a
      textarea that changed after `postMessage`.
- [ ] Rejected findings do not appear as slots in the artifact; rejected
      plaintext remains in `artifact.content`.
- [ ] Public bundle JSON and captured logs contain none of the removed
      plaintext and no slot keys. `DemoVaultEntry` / demo vault is not imported.
- [ ] File picker accept list matches the demo: `.txt,.md,.json,.csv,text/*`.
- [ ] Publish from the connected wallet as `author`. On-chain `slotIds` match
      the artifact. Publish disabled when disconnected.
- [ ] `docHash` in the UI equals `artifact.documentId` and
      `DocumentPublished.docHash`.
- [ ] Live `useDocumentEvents` shows the new document without a full reload.
- [ ] No demo layout/CSS/brand in the PR. Brand is SoulVault identity.
- [ ] Typecheck + `build:export` green. Add `@soulvault/presidio-adapter` to
      `apps/web` dependencies and `transpilePackages`.

## Blocked by

- Dashboard chrome (shell + events provider)

## Implementation notes

- Adapter README is the short version of this ticket. If the dashboard needs
  `expandSemanticOccurrences`, add it to the adapter (port from
  `presidio-web-demo/src/lib/semantic-occurrences.ts`) — do not paste it into
  a React file.
- GLiNER / OPFS installer is **not** this ticket. Patterns are enough for the
  hack path. The `semanticFindings` argument is the extension point, same as
  the demo’s `useGliner` flag.
- Overflow/located slots: protocol chooses inline vs locator. No extra UI
  control in v0; fail closed on unresolved locators.
- Do not grant in this ticket.
