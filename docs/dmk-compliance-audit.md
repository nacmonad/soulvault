# DMK compliance audit

Audit date: 2026-09-05

## Outcome

SoulVault's Node/CLI Ledger signer already uses DMK, the Ethereum Device Signer
Kit, Node HID, an ethers adapter, and Speculos/hardware integration tests. It is
not obsolete and should not be replaced.

The browser had no equivalent device layer. The new browser provider adds one
DMK instance per React tree, WebHID discovery initiated by an explicit user
action, a refreshed device session, live device state, on-device address
verification, bounded timeouts, disconnect cleanup, and classified user-facing
errors. It exposes no dashboard UI.

The audit also found an SDK peer mismatch: Ethereum Signer Kit 1.16 requires
Context Module 2.x while the workspace specified 1.x. The workspace is now
aligned on Context Module 2.5.

## Browser contract

`SoulVaultLedgerProvider` exposes a connector-neutral wallet session. A later UI
can choose either direct Ledger/DMK sign-on or an injected EIP-1193 browser
wallet; both feed the same address and activity state. It exposes:

- `connectLedger()`, `connectBrowserWallet()`, and `disconnect()`;
- the active connector (`ledger` or `browser-wallet`);
- the verified Ledger Ethereum address;
- live DMK device/session state;
- connection and activity-loading status;
- `refreshActivity()` and decoded SoulVault activity involving the address.

Activity discovery scans an explicit deployment manifest. It includes events
whose decoded arguments reference the address and events emitted during a
transaction initiated by the address. The latter requires resolving transaction
senders because an event's emitter is the contract, not the user's wallet.

Configure the browser with:

```dotenv
NEXT_PUBLIC_SOULVAULT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
NEXT_PUBLIC_SOULVAULT_CHAIN_ID=11155111
NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS=[{"kind":"swarm","address":"0x...","fromBlock":"1234567","label":"primary"}]
```

Supported `kind` values are `swarm`, `treasury`, and `identity`. Every entry must
use the actual deployment block so the browser does not attempt an unbounded
chain scan.

## Remaining hardware checks

- Exercise connect, rejection, lock, disconnect, and reconnect with a physical
  Ledger in Chromium over HTTPS or localhost.
- Confirm the Ethereum address at derivation path `44'/60'/0'/0/0` on-device.
- Capture Ledger documentation/tooling friction as required submission feedback.
- Add the future grant/revoke signing methods through the same provider; do not
  create a second DMK instance.
- Obtain the Ledger origin token / CAL path required for the intended Clear
  Signing experience before claiming human-readable transaction checks.
