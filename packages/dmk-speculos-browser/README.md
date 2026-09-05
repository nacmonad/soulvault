# `@soulvault/dmk-speculos-browser`

Development-only Ledger DMK transport and test controller for driving browser
applications against Speculos. It models one emulated Nano S Plus and forwards
APDUs through an HTTP bridge. It is not a production wallet connector.

## Framework-neutral usage

[`examples/vanilla.ts`](examples/vanilla.ts) registers the transport directly
with DMK, discovers and connects the emulated device, and derives a verified
Ethereum address. While the DMK action is pending, the test runner must use the
separate controller export to navigate and explicitly approve or reject the
Speculos review. The package never auto-approves a device action.

```ts
import { connectSpeculos } from './examples/vanilla.js';

const wallet = await connectSpeculos('http://127.0.0.1:41235/apdu');
console.log(wallet.address);
await wallet.disconnect();
```

SoulVault's React proof route is a consumer example, not part of this package's
public model.

## Test topology

The browser cannot talk directly to Speculos' loopback API under normal browser
CORS and Private Network Access rules. The Playwright worker fixture therefore:

1. reuses a reachable Speculos API or starts the pinned official container;
2. mounts an externally supplied application ELF read-only;
3. starts a loopback APDU/events bridge with explicit CORS/PNA headers;
4. gives tests a controller for screen polling and button presses; and
5. tears down the bridge and any container it created.

Required environment when the fixture must start Speculos:

- `SOULVAULT_SPECULOS_APP_ELF`: absolute path to a locally built or otherwise
  lawfully obtained Ledger application ELF;
- `SOULVAULT_SPECULOS_IMAGE`: official Speculos image pinned by full
  `@sha256:` digest;
- `SOULVAULT_SPECULOS_EXPECTED_ADDRESS`: optional deterministic address check.

Alternatively, `SOULVAULT_SPECULOS_API_URL` may identify an already-running,
reachable Speculos instance.

## Commands

```sh
pnpm --filter @soulvault/dmk-speculos-browser test
pnpm --filter @soulvault/dmk-speculos-browser typecheck
pnpm --filter @soulvault/dmk-speculos-browser test:speculos
pnpm --filter @soulvault/dmk-speculos-browser test:browser
```

The real integration and browser commands require Speculos plus the external
ELF. Unit tests and typechecking do not.

## Security and licensing boundaries

- Never commit or publish an ELF, seed, mnemonic, transcript, trace, video,
  environment file, or SoulVault deployment configuration with this package.
- Obtain Ledger application binaries from their official source and comply with
  the application's license. The package intentionally does not redistribute
  them.
- Speculos proves browser integration and the device-action state machine. It
  does not prove WebHID discovery, physical possession, secure-element behavior,
  or hardware attestation.
- Before a production release, separately validate connect, verified address,
  rejection, disconnect, and reconnect with a physical Ledger over WebHID on a
  secure Chromium origin.
