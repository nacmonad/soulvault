---
name: dmk-speculos-browser
description: "Drive Ledger DMK browser tests against Speculos, Ledger's device emulator, using @soulvault/dmk-speculos-browser. Use when a developer needs to run browser-based Ledger signing tests (Playwright + Chromium), wire the emulated transport into DMK, control the emulated device screen and buttons from a test, or record a reproducible proof of a device-signed flow. Covers the transport registration, the test controller, the Playwright fixture, required environment variables, and the concurrency rule that tests must never auto-approve device actions."
---

# Speculos browser testing with `@soulvault/dmk-speculos-browser`

This skill explains how to run Ledger DMK flows in a real browser against an
emulated device. Speculos stands in for the physical Nano S Plus; the browser
talks to it over HTTP, so no USB hardware is needed and the whole flow runs in
CI. Load `ledger-dmk-implementation` for the DMK session flow itself — this
skill only covers the emulation layer underneath it.

## Connectors

**Sibling skills:**
- `ledger-dmk-implementation` — the DMK signing flow (init, session, state, app, operation). The speculos transport plugs in at its Step 1/2 as a drop-in replacement for WebHID.
- `dmk-business-logic` — conceptual background on transports and device actions.

**Reference files in the package:**
- `packages/dmk-speculos-browser/README.md` — commands, topology, security boundaries.
- `packages/dmk-speculos-browser/TRANSPORT-CONTRACT.md` — transport behavior contract.
- `packages/dmk-speculos-browser/examples/vanilla.ts` — framework-neutral DMK registration example.
- `packages/dmk-speculos-browser/test/playwright-fixture.ts` — the fixture consumed by browser tests.

## The three exports

| Import | Gives you | Use it for |
|---|---|---|
| `@soulvault/dmk-speculos-browser` | `createSpeculosTransport(options)` → `{ identifier, factory, metadata: { emulated: true } }` | Registering the emulated transport with DMK so `dmk.startDiscovering()` / `dmk.connect()` find a fake Nano S Plus. `options` requires `apduUrl`; optional `fetch`, `requestTimeoutMs` (default 10s). |
| `@soulvault/dmk-speculos-browser/test` | `createSpeculosController({ apiUrl })` | Driving the emulated device from test code: `pollScreen`, `waitForScreen(matcher)`, `pressLeft/Right/Both`, `approve(matcher?)`, `reject(matcher?)`, `getTranscript()`. |
| `@soulvault/dmk-speculos-browser/playwright` | Worker-scoped `test`/`expect` fixture exposing `{ apiUrl, apduUrl, eventsUrl, controller, emulated }` | Playwright suites. The fixture reuses a reachable Speculos or starts the pinned container, mounts the app ELF, and starts the APDU/events bridge with teardown in `finally`. |

## The concurrency rule (most common mistake)

The DMK action promise blocks while the device waits for user confirmation.
The controller's `approve()` / `reject()` must run **concurrently** with that
pending promise, never after awaiting it:

```ts
// Correct — controller approval races the pending device action
const [wallet] = await Promise.all([
  connectSpeculos(apduUrl),                     // blocks on device review
  controller.approve(),                         // waits for approve screen, presses both buttons
]);

// Wrong — the action promise never resolves, test hangs until timeout
const wallet = await connectSpeculos(apduUrl);  // deadlock
await controller.approve();
```

In Playwright the same rule applies: never `await` the DMK-driven page action
before issuing `controller.approve()`. Kick off the action, then approve.

**Never auto-approve.** Approval is always an explicit controller call waiting
for the real screen text. The package has no "press through anything" mode by
design; do not add one.

## Why the bridge exists

Browsers cannot reach Speculos' loopback HTTP API directly because of CORS and
Private Network Access restrictions. The Playwright worker therefore starts an
APDU/events bridge (`test/apdu-bridge.ts`) with explicit CORS/PNA headers.
Tests talk to the bridge URLs (`apduUrl`, `eventsUrl`); the controller talks
to `apiUrl` directly from the worker process, which has no browser
restrictions.

## Environment

The fixture needs one of these setups:

- **Existing Speculos:** `SOULVAULT_SPECULOS_API_URL` pointing at a reachable instance.
- **Managed container (full proof):**
  - `SOULVAULT_SPECULOS_APP_ELF` — absolute path to a lawfully obtained Ledger
    Ethereum app ELF. Never commit or redistribute it.
  - `SOULVAULT_SPECULOS_IMAGE` — official Speculos image pinned by full
    `@sha256:` digest. The fixture refuses a tag that is not digest-pinned.
  - `SOULVAULT_SPECULOS_EXPECTED_ADDRESS` (optional) — deterministic address check.

## Commands

```sh
pnpm --filter @soulvault/dmk-speculos-browser test              # unit tests, no Speculos needed
pnpm --filter @soulvault/dmk-speculos-browser typecheck         # no Speculos needed
pnpm --filter @soulvault/dmk-speculos-browser test:integration  # needs Speculos + ELF
pnpm --filter @soulvault/dmk-speculos-browser test:browser      # Playwright, needs Speculos + ELF
pnpm --filter @soulvault/dmk-speculos-browser proof:browser     # full recorded proof (video, trace, transcript)
```

Only the unit tests and typecheck run without Speculos and the ELF. The
browser transport is a dev/test tool — it is not a production wallet connector
and should never ship in the app bundle.

## Writing a browser test

1. Import `test, expect` from `@soulvault/dmk-speculos-browser/playwright`, not `@playwright/test` directly.
2. Use the `speculos` fixture to get `apduUrl` (for the app's transport) and `controller` (for device input).
3. In the page, register `createSpeculosTransport({ apduUrl })` with DMK in place of the WebHID transport.
4. Start the DMK action, then call `controller.approve()` concurrently (see the rule above).
5. Assert on results in the page, and use `controller.getTranscript()` when you need evidence of what the device displayed and which buttons were pressed.

The default approve/reject matcher is `/approve|accept and send|sign/i`.
Pass a custom matcher when the flow shows different screen text.

## Boundaries

Speculos proves browser integration and the device-action state machine. It
does **not** prove WebHID discovery, physical possession, secure-element
behavior, or hardware attestation. Validate connect, verified address,
rejection, disconnect, and reconnect on real hardware before any release.
