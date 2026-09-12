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

### Author review canvas (required — this is the redact UX)

The source snapshot is an **inline review surface**, not a dead textarea after
scan. Presidio findings are proposals. The author is the last word.

1. **Render the scanned text with highlights** (absolute offsets). Detector
   spans and author spans share one overlay. Click a highlight to edit it.
2. **Manual redact:** drag/select any range the detectors missed. That opens a
   small popover (not a full-page form):
   - Classify: `PERSON`, `PHONE_NUMBER`, `EMAIL_ADDRESS`, `US_SSN`,
     `CREDIT_CARD`, `MEDICATION` / medical, plus a free-text entity type.
   - Show the **derived `slotId`** (adapter `indexFindings` default:
     `pii-{entity}-{hash(entityType, normalizedValue)}`).
   - Author may **finalize or edit** that `slotId` before accept. This is the
     public marker (`{{sv:slotId}}`), not the AES slot key.
   - Reuse an existing `slotId` only when entity type **and exact plaintext**
     match (protocol throws otherwise). Offer existing slots that already
     match this value; do not silently merge different strings.
3. **Detector findings** use the same popover (accept / reject / reclassify /
   override `slotId`). Rejected detector spans stay in the plaintext.
4. Only accepted spans — detector **or** manual — go to
   `redactAcceptedFindings` / `ReviewedSensitiveSpan`. Each accepted slot
   gets a fresh AES-256-GCM key in `slotKeys` (the secret bundle for
   Grants/publish). Author never types or sees raw slot keys.
5. Public bundle is `serializePublicDocumentBundle` (artifact + encrypted
   slots, **no** `slotKeys`, **no** `originalValue`).
6. `slotKeys` persist in localStorage under `soulvault.document.*` (wallet-
   scoped by key prefix), with sessionStorage fallback on load — this survives
   tab close and origin/port changes so grants are not bricked by a reload.
   Tradeoff: raw keys rest in the browser; wrap with a wallet-derived KEK
   before pointing real PII at this flow. Never log them.
7. Show protocol markers (`{{sv:...}}` from the artifact) beside the reviewed
   source. Connected author publishes `DocumentPublished(docHash, author,
   slotIds)`. `docHash === artifact.documentId`.
8. CTA: “Continue to Grants” with the in-session document selected.

Do **not** import `DemoVaultEntry` / the demo vault. Manual classification is
a `ReviewableFinding` with `source: 'author'`. This is a **confirmed adapter
gap**: `AnalyzerFinding.source` is currently `'presidio' | 'semantic'` in
`packages/presidio-adapter/src/findings.ts`. Extend the union with `'author'`
there (and anywhere the worker protocol tightens it) as a prerequisite change
in this PR — do not invent a second span type in the page.

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
- [ ] Scanned text is highlighted in-place. Author can select an arbitrary
      range, get a classify popover (name / phone / SSN / medication / …),
      and accept a finalized `slotId` that becomes `{{sv:slotId}}`.
- [ ] Manual spans and accepted detector spans share one slot list. Same
      `slotId` is allowed only for the same entity type + exact value.
- [ ] `@soulvault/presidio-adapter` accepts `source: 'author'` findings;
      manual spans pass through `indexFindings` / `redactAcceptedFindings`
      unchanged.
- [ ] Finalized accepted `slotId`s appear in `artifact.slots` and in the
      in-session `slotKeys` bundle used by Grants. Raw keys never shown.
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

- Adapter README is the short version of this ticket. `expandSemanticOccurrences`
  lives in the adapter (port from
  `presidio-web-demo/src/lib/semantic-occurrences.ts`) — not in a React file.
- GLiNER / OPFS installer is optional and lazy, same motor as the demo: worker
  owns ONNX Runtime Web + Knowledgator `gliner-pii-edge-v1.0`. Toggle is off
  until the author installs the model. `semanticFindings` remains the
  extension point.
- Overflow/located slots: protocol chooses inline vs locator. No extra UI
  control in v0; fail closed on unresolved locators.
- Do not grant in this ticket.
- The classify popover is the authoring UX. A side list of findings is
  optional, not a substitute for inline highlight + classify.
- `slotId` is the shareable identifier. The AES key is derived at encrypt
  time (`redactAndEncryptDocument`) and only lives in `slotKeys`.
