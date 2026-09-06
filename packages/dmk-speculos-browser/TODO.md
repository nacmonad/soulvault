# DMK Speculos Browser Transport

Build a reusable, test-only bridge that lets browser applications exercise Ledger
DMK flows against Speculos in automated tests. SoulVault is the first consumer, not
part of the package's public model.

## Outcome

A Playwright test can connect a browser DMK instance to Speculos, derive an Ethereum
address, observe device-action states, approve or reject an operation through the
Speculos API, disconnect, and reconnect. The consuming application uses the same
session-facing interface as its WebHID connector.

The package must identify every session as emulated. Passing this suite proves browser
integration behavior; it does not prove USB/WebHID behavior, physical possession, or
hardware attestation.

## Package boundary

- Workspace package: `@soulvault/dmk-speculos-browser`.
- Browser-safe runtime: no Node built-ins, Docker control, filesystem access, seed
  management, or bundled Ledger application ELF.
- Development-only entry point with `sideEffects: false` and production import guard.
- Transport Speculos APDUs through a configurable HTTP bridge. Do not couple the
  package to SoulVault contracts, React, ethers, or an Ethereum derivation path.
- Keep container lifecycle and ELF provisioning in test-runner fixtures outside the
  browser bundle.

## Public API

Start with the smallest API that can satisfy DMK transport registration:

```ts
type SpeculosBrowserOptions = {
  apduUrl: string;
  apiUrl?: string;
  fetch?: typeof globalThis.fetch;
};

type EmulatedLedgerMetadata = {
  emulated: true;
  transport: "speculos-http";
};

createSpeculosTransport(options: SpeculosBrowserOptions): {
  identifier: string;
  factory: unknown;
  metadata: EmulatedLedgerMetadata;
};
```

Replace `unknown` with Ledger's actual transport-factory type after compiling a tracer
implementation against DMK 1.8. Do not publish a parallel wallet/session abstraction;
DMK remains the owner of discovery, connection, state, actions, and teardown.

Provide test helpers from a separate export:

```ts
import {
  createSpeculosController,
  waitForDeviceScreen,
} from "@soulvault/dmk-speculos-browser/test";
```

The controller may read screens and press buttons. It must not silently approve an
operation; every approval or rejection is an explicit test action.

## Implementation sequence

### Verified progress

- [x] Scaffolded the workspace package with a browser-only TypeScript target,
  DMK 1.8 peer dependency, focused unit tests, and typecheck scripts.
- [x] Recorded every `Transport` method and the official Speculos transport's
  discovery, app-version APDU, connection, error, and teardown behavior in
  [`TRANSPORT-CONTRACT.md`](TRANSPORT-CONTRACT.md).
- [x] Compiled the public registration API as a real DMK `TransportFactory` and
  verified its explicit emulation metadata without TypeScript casts.
- [x] Implemented deterministic discovery, connection, disconnection, and
  browser `fetch` APDU exchange with DMK `Either` results and response framing.
- [x] Completed the stage-one tracer by driving one in-memory Ethereum address
  action through DMK.
- [x] Added stable transport errors for HTTP failures, malformed responses, and
  invalid APDU hex; failed exchanges preserve causes and emit one disconnect.
- [x] Completed the browser transport lifecycle with bounded APDU requests,
  explicit abort on disconnect, connection-loss mapping, concurrent-action
  rejection, cleanup, and reconnect coverage (9 unit tests; package typecheck
  green).
- [x] Added the separate `@soulvault/dmk-speculos-browser/test` controller API
  with bounded screen polling, explicit button/approve/reject operations, and
  immutable timestamped transcripts.
- [x] Proved controller approval, rejection, and timeout behavior against the
  checked-in Speculos screen/button protocol fixtures (13 package tests green;
  package typecheck green).
- [x] Added an opt-in real-Speculos integration entry point that derives and
  verifies an Ethereum address through DMK, asserts intermediate/final action
  states, and records the explicit controller approval. It skips cleanly until
  `SOULVAULT_SPECULOS_API_URL` is provisioned.
- [x] Added a package-local test lifecycle runner that either reuses a reachable
  Speculos API or starts a headless container from an externally supplied ELF;
  new containers require an official image pinned by digest and mount only the
  ELF directory read-only.
- [x] Added the real-transport disconnect/reconnect assertion: DMK creates a new
  session after teardown while the same derivation path returns the same
  identity.
- [x] Built Ledger's official Nano S Plus Ethereum 1.22.3 source at commit
  `d6d699bcdaf5dc4d99722f38cbbbfb466c0f3163` with the official builder image
  (`sha256:414ebf2c...65eee4`), verified the local ELF hash
  (`sha256:48ebe0ae...fb3952`), and passed both real DMK address verification and
  disconnect/reconnect tests against the pinned official Speculos image.
- [x] Added a real device-action rejection path that navigates to the Nano S
  Plus `Cancel` screen, confirms explicitly through the controller, and asserts
  that DMK surfaces the rejected address action as an error.
- [x] Added a real disconnect-during-action path that aborts the pending browser
  APDU, resets the emulated device explicitly, reconnects with a new DMK session,
  and derives the address successfully afterward.
- [x] Added deterministic Ethereum-app setup for blind signing and passed a real
  EIP-712 `Rehydrate` signature through DMK, the browser transport, explicit
  Speculos review/approval, and the pinned Nano S Plus app (5/5 real integration
  tests green).
- [x] Added a typed Playwright worker fixture that provisions/reuses Speculos,
  starts a loopback CORS APDU bridge, exposes the explicit test controller, and
  guarantees bridge/container teardown. The bridge forwarding/preflight test,
  package suite (15 passing), and full package/test typecheck are green.
- [x] Added a narrowly typed development-only DMK transport injection prop to
  SoulVault's wallet provider. It selects the injected identifier/factory for
  the existing wallet context, enables the emulator's already-open-app flow,
  and rejects injection in production. Focused provider lint and package tests/
  typecheck pass; the full web typecheck remains blocked by the pre-existing
  missing `LayoutProps` type in `src/app/layout.tsx`.
- [x] Added a development-only React proof route with a plain **Sign in with
  Ledger** button, visible wallet status/address, disconnect control, and an
  explicit emulation evidence label. The route consumes the real SoulVault
  wallet context and package transport, compiles under Next development mode,
  returns HTTP 200, and is guarded unavailable in production.
- [x] Added the first real Chromium vertical slice: Playwright clicks **Sign in
  with Ledger**, waits without disturbing the emulated app home, explicitly
  approves the address on Speculos, and asserts the rendered connected address.
  Passing runs record WebM video and a trace. This also caught and fixed the
  browser-native `fetch` receiver binding at the transport boundary and added
  Private Network Access CORS support to the loopback bridge.
- [x] Made the recorded proof legible by holding on the sign-in and connected
  states and mirroring live Speculos screen events beside the React wallet UI.
  The browser test now also disconnects, reconnects through a new device review,
  and proves the same rendered address survives the session lifecycle.
- [x] Completed the rendered-browser rejection path: Playwright explicitly
  navigates to and confirms the device's `Cancel` screen, asserts the wallet
  context exposes the rejection without an address, then signs in and completes
  the disconnect/reconnect lifecycle. The real Chromium + pinned Speculos run
  passes with failure screenshots, video, trace, and device transcript capture.
- [x] Documented the reusable package topology, required environment, ELF and
  security boundaries, CI commands, limitations, and physical WebHID checklist.
  Added a framework-neutral, typechecked DMK address example that leaves every
  Speculos approval or rejection to the external test controller.
- [x] Added the package build/lint/example/integration script surface and a
  strict tarball allowlist. A dry-run pack contains only the typed runtime,
  reusable fixture/controller support, example, and documentation—no ELF,
  seed, environment, generated evidence, test cases, or SoulVault app code.
- [x] Added a clean-checkout `proof:browser` command and retained proof metadata:
  exact DMK, Ethereum Signer Kit, Playwright, Node, pinned Speculos image, ELF
  SHA-256, and derived address now accompany the video, trace, and screen
  transcript in the Playwright result. The address, metadata, and transcript are
  also retained as obvious standalone files beside the video and trace.
- [x] Verified the reuse boundary end to end: the real-Speculos integration suite
  packs the allowlisted tarball, installs it into a temporary project outside
  the workspace, imports only public package exports, explicitly approves the
  address review, and derives the expected deterministic address.

### 1. Trace the transport contract

- Inspect DMK's registered transport interface and the official Node Speculos
  transport behavior at the versions pinned by this workspace.
- Record APDU framing, discovery emissions, connection identifiers, errors, teardown,
  and cancellation behavior in package tests.
- Build the smallest in-memory tracer proving DMK can complete one address action.

Complete when a failing contract test describes every method the browser transport
must implement and no method is inferred only from TypeScript casts.

### 2. Implement the browser transport

- Translate DMK send/receive operations to the configured Speculos APDU endpoint.
- Model one deterministic emulated device per configured endpoint.
- Propagate abort, timeout, connection loss, malformed response, and APDU failure as
  stable typed errors with original causes.
- Release subscriptions and in-flight requests on disconnect or dispose.

Complete when unit tests cover connect, APDU exchange, abort, disconnect, reconnect,
and concurrent-action rejection without Docker or a browser.

**PASS:** verified without Docker or a browser by the package unit suite.

### 3. Add the Speculos controller

- Poll the REST screen/events endpoint without fixed sleeps.
- Expose explicit `pressLeft`, `pressRight`, `pressBoth`, `approve`, and `reject` test
  operations.
- Capture a timestamped screen transcript suitable for CI artifacts.
- Bound every poll and action with configurable timeouts.

Complete when controller tests drive the checked-in test fixture protocol and prove
both approval and rejection paths deterministically.

**PASS:** checked-in protocol fixtures deterministically cover approval and rejection;
polling and every REST action are timeout-bounded.

### 4. Prove real DMK compatibility

- Start the existing official Speculos image with the externally provisioned Ethereum
  ELF from the test runner.
- Register the browser transport in DMK and use Ethereum Signer Kit to derive the
  deterministic address.
- Exercise typed-data signing, transaction signing, rejection, disconnect during an
  action, and reconnect.
- Assert DMK intermediate states and final results, not only valid signatures.

Complete when the integration suite passes against the pinned official image and
Ethereum app version from a clean checkout with the ELF supplied by environment path.

**PASS:** the pinned Speculos image and externally supplied official Nano S Plus
Ethereum ELF pass the six-test real-DMK suite: verified address, stable reconnect,
user rejection, disconnect/abort recovery, EIP-712 signing, and EIP-1559 transaction
signing. The tests assert DMK action states/results and explicit controller review.

### 5. Add browser automation fixtures

- Provide a Playwright fixture that starts/stops the APDU bridge and exposes the
  controller to tests.
- Add a development-only connector selection hook to SoulVault's wallet provider.
- Run connect, verified-address, reject, disconnect, and reconnect flows through the
  rendered browser application.
- Save device transcripts and browser screenshots on failure.

Complete when a headless Chromium test exercises SoulVault's real wallet context with
no production code path capable of selecting Speculos.

**PASS:** a real Chromium run now covers explicit rejection, successful verified
address connection, disconnect, and stable-address reconnect through SoulVault's
development-only transport injection. Playwright retains screenshots on failure plus
video, trace, address, and device transcript evidence.

### 6. Package for reuse

- Add package metadata, typed exports, build, lint, unit, integration, and example
  scripts.
- Document prerequisites, CORS/network topology, ELF licensing/provisioning, CI usage,
  limitations, and the physical-device validation checklist.
- Include a framework-neutral example before any React convenience wrapper.
- Verify the packed tarball contains no ELF, seed, SoulVault configuration, generated
  transcript, or environment file.

Complete when `pnpm pack --dry-run` is clean and a minimal example outside the package
can install the tarball and derive the expected Speculos address.

**PASS:** the allowlisted dry-run pack is clean, and the external temporary
consumer installs the real tarball and derives the expected address against the
pinned official Speculos/Ethereum app stack using only public exports.

### 7. Record the end-to-end proof of concept

- Add a minimal React example with a plain **Sign in with Ledger** button and a
  visible signed-in address/state. Keep product-dashboard concerns out of it.
- Have Playwright click the button through the explicit development-only connector,
  causing the browser DMK flow to exchange real APDUs with the pinned Ethereum app
  running in Speculos.
- Drive each required Speculos approval explicitly from the test controller and
  assert the expected deterministic Ethereum address in the rendered React UI.
- Record the passing Playwright run as video and retain the device-screen transcript,
  browser trace, and version/setup metadata beside it as CI artifacts.
- Include an on-screen or adjacent evidence label stating that Speculos proves the
  browser integration and device-action state machine, not WebHID discovery,
  physical possession, or hardware attestation.

**Final PASS gate:** from a clean checkout with the externally supplied ELF, one
documented command starts the bridge and Speculos, serves the React example, runs
Playwright in video-recording mode, clicks **Sign in with Ledger**, explicitly
approves the device action, and finishes green with the deterministic address visible.
The retained video, screen transcript, Playwright trace, and exact dependency/image/
ELF versions are sufficient for another developer to reproduce the proof without
SoulVault dashboard code.

## Acceptance suite

- Unit: transport framing, error mapping, abort, cleanup, and controller polling.
- Integration: DMK + Ethereum Signer Kit + official Speculos + Ethereum ELF.
- Browser: Chromium + real application context + explicit test connector injection.
- Proof: recorded React sign-in button → browser DMK → Speculos approval → verified
  address, reproducible with one documented command from a clean checkout.
- Regression: existing Node Speculos suite remains green.
- Manual: physical Ledger/WebHID connect, verify, reject, disconnect, and reconnect
  stays a separate required check.

## Evidence for Ledger

Capture the missing browser-to-Speculos path, SDK/version friction, exact setup time,
CI transcript, and the boundary between emulated transport coverage and physical
WebHID validation. Propose an upstream API or documentation addition only after the
package contract is proven by the acceptance suite.
