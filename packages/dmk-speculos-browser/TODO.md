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

### 3. Add the Speculos controller

- Poll the REST screen/events endpoint without fixed sleeps.
- Expose explicit `pressLeft`, `pressRight`, `pressBoth`, `approve`, and `reject` test
  operations.
- Capture a timestamped screen transcript suitable for CI artifacts.
- Bound every poll and action with configurable timeouts.

Complete when controller tests drive the checked-in test fixture protocol and prove
both approval and rejection paths deterministically.

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

### 5. Add browser automation fixtures

- Provide a Playwright fixture that starts/stops the APDU bridge and exposes the
  controller to tests.
- Add a development-only connector selection hook to SoulVault's wallet provider.
- Run connect, verified-address, reject, disconnect, and reconnect flows through the
  rendered browser application.
- Save device transcripts and browser screenshots on failure.

Complete when a headless Chromium test exercises SoulVault's real wallet context with
no production code path capable of selecting Speculos.

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
