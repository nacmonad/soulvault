# Documents e2e: Alice / Charlie / Mallory with Ledger over Speculos

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## What to build

The headless acceptance scenario already exists
(`packages/node/src/__integration__/document-acceptance-scenario.integration.test.ts`).
This ticket replays it in the **built dashboard app** with a real browser and
an emulated Ledger, and is the **epic exit gate**: no demo without a recorded
proof.

Harness: `@soulvault/dmk-speculos-browser` (Playwright fixture). Speculos
stands in for the Nano S Plus; the browser registers
`createSpeculosTransport({ apduUrl })` with DMK in place of WebHID when the
connect panel selects "Ledger". The Speculos transport is test-only wiring —
it never ships in the app bundle.

### Scenario

1. Speculos boots with the Ethereum app (existing instance or managed
   container).
2. **Alice** (injected-wallet mock) redacts the synthetic Alice fixture in
   Documents → Redact, accepts detector findings plus one **manual** span
   (requires the adapter `source: 'author'`), and publishes.
   `DocumentPublished` appears in the events cache; `docHash` matches the
   artifact.
3. **Charlie** connects via the emulated Ledger. The rehydration-key
   attestation is clear-signed through the DMK session.
4. **Alice** grants the slots from Documents → Grants; the grant tx is
   clear-signed on the emulated device.
5. **Charlie** loads the downloaded public bundle into Documents → Rehydrate,
   passes the Ledger gate, and toggles exactly the granted slots to
   plaintext. Ungranted markers stay redacted.
6. **Mallory** (injected-wallet mock) gets no plaintext anywhere — content,
   DOM, or typed error messages.

### Concurrency rule (non-negotiable)

Never `await` the DMK-driven page action before issuing
`controller.approve()`. The action promise blocks on device confirmation;
approval must race it. Every approval is an explicit
`controller.approve(matcher)` waiting for real screen text — **never
auto-approve**. The package has no "press through anything" mode by design.

### Proof

Capture a `proof:browser`-style run: video, Playwright trace, and
`controller.getTranscript()` showing what the device displayed and which
buttons were pressed. Store artifacts as CI artifacts, not in git.

## Acceptance criteria

- [ ] Suite imports `test, expect` from
      `@soulvault/dmk-speculos-browser/playwright`, not `@playwright/test`
      directly.
- [ ] Alice → publish, Charlie attestation clear-sign, Alice grant
      clear-sign, Charlie rehydrate, Mallory fail-closed — all pass in one
      run against the production build (`build:export` output or
      `next start` equivalent for the export mode).
- [ ] No test path auto-approves; transcripts prove each approval waited for
      the matching screen.
- [ ] Video + trace + device transcript captured as proof.
- [ ] Speculos transport is never bundled into app code (test wiring only).
- [ ] Runnable via a documented command (e.g.
      `pnpm --filter soulvault-web test:e2e:ledger`) using
      `SOULVAULT_SPECULOS_API_URL`, or the managed container via
      `SOULVAULT_SPECULOS_APP_ELF` + digest-pinned image.

## Blocked by

- Documents → Grants (004)
- Documents → Rehydrate (005)

## Implementation notes

- Environment: `SOULVAULT_SPECULOS_API_URL` for an existing Speculos
  instance; or the managed container with `SOULVAULT_SPECULOS_APP_ELF`
  (absolute path to a lawfully obtained Ledger Ethereum app ELF — never
  commit or redistribute it) and `SOULVAULT_SPECULOS_IMAGE` pinned by full
  `@sha256:` digest. Optional `SOULVAULT_SPECULOS_EXPECTED_ADDRESS` for a
  deterministic address check.
- Browsers cannot reach Speculos' loopback HTTP API directly (CORS / Private
  Network Access). Use the fixture's APDU/events bridge URLs for the
  in-page transport; the controller talks to `apiUrl` from the worker
  process.
- The World gate is off in this suite (deferred to the World feature branch,
  see 005); the Ledger clear-sign gate is the one under test.
- Use the synthetic Alice fixture text from the headless acceptance
  scenario. No real PII.
- Speculos proves browser integration and the device-action state machine.
  It does not prove WebHID discovery, physical possession, or secure-element
  behavior — release validation on real hardware remains a human step.
- Default approve matcher is `/approve|accept and send|sign/i`; pass a
  custom matcher if the flow shows different screen text (e.g. EIP-712
  attestation signing screens).
