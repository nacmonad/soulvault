# Clear-Signing Runbook

Operator-facing setup guide for the Speculos + hardware Ledger integration suites.

> Companion docs: [`clear-signing-spec.md`](./clear-signing-spec.md) (design) · [`clear-signing-parity.md`](./clear-signing-parity.md) (test map) · [`clear-signing-limitations.md`](./clear-signing-limitations.md) (known gaps)

## §1 Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | fnm / asdf / brew |
| pnpm | ≥ 9 | `corepack enable && corepack prepare pnpm@latest --activate` |
| Foundry | latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| Docker | ≥ 24 | Docker Desktop / engine |
| ens-app-v3 local node | (repo's pinned version) | see repo README for bring-up; must listen on `127.0.0.1:8545` |

Check: `docker --version && forge --version && node --version && pnpm --version`.

## §2 Speculos assets

Speculos needs the Ledger Ethereum app ELF for the target device model. It is **not** redistributed here.

1. Clone the app source or download the official ELF:
   ```
   # Nano X example
   curl -L -o cli/test/speculos/apps/nanox-ethereum.elf \
     https://github.com/LedgerHQ/app-ethereum/releases/download/<version>/app_nanox.elf
   ```
2. `cli/test/speculos/apps/` is gitignored (add entry if not already there).
3. Override the path at runtime via `SOULVAULT_SPECULOS_APP_ELF=/abs/path/to/app.elf`.

> **Checkpoint (human verification required):** The first time you run `pnpm test:speculos`, confirm Speculos boots by opening `http://127.0.0.1:5000/events` in a browser and watching for app-home events. The test runner will also log `[speculos-setup] Speculos ready at ...`.

## §3 Environment files

Copy `.env.example` to `.env.test` and fill in:

```
SOULVAULT_SIGNER_MODE=ledger
SOULVAULT_RPC_URL=http://127.0.0.1:8545
SOULVAULT_ENS_RPC_URL=http://127.0.0.1:8545
SOULVAULT_CHAIN_ID=1337
SOULVAULT_ENS_CHAIN_ID=1337
SOULVAULT_LEDGER_DERIVATION_PATH=m/44'/60'/0'/0/0
SOULVAULT_LEDGER_CLEAR_SIGN_MODE=clear-sign-preferred
SOULVAULT_PRIVATE_KEY=<funder priv key — account[0] on local ens-app-v3>
```

For the hardware suite, additionally create `.env.ledger.test` with `SOULVAULT_LEDGER_TEST_ADDRESS` set to the expected device address.

## §4 DMK ↔ Speculos transport wiring

The signer uses `@ledgerhq/device-management-kit` (DMK). Speculos speaks raw APDU on `POST /apdu`. There are two ways to bridge them:

1. **(Recommended)** Install the speculos transport kit and register it with the DMK builder. This repo ships a stub in `cli/test/speculos/transport.ts` that dynamically imports `@ledgerhq/device-transport-kit-speculos` if present.
2. **(Fallback)** Use the low-level `apduExchange()` helper in `transport.ts` for tests that sign raw APDUs directly and skip the high-level `SignerEth` (useful when the speculos transport kit is not yet packaged on npm).

> **Checkpoint:** If `pnpm test:speculos` fails with "No Ledger transport registered", add `@ledgerhq/device-transport-kit-speculos` to `cli/package.json` and wire it in `cli/src/lib/signer.ts` similarly to `nodeHidTransportFactory`. Document the version in `clear-signing-limitations.md`.

## §5 Hardware suite

1. Physical Ledger Nano S+/X, firmware current, Ethereum app installed + current.
2. Device seeded with the **test-only** 24-word seed (`cli/test/speculos/seed.txt` line or equivalent). Never use this seed on mainnet.
3. Plug into a direct USB port (no unpowered hub). Quit Ledger Live.
4. `.env.ledger.test` populated as in §3 + `SOULVAULT_LEDGER_TEST_ADDRESS`.
5. Run: `pnpm test:ledger`. Be at the keyboard — each test pauses for `y/N` approval after the checklist renders.

## §6 Commands

```bash
# Fast unit tests (no chain, no device)
cd cli && pnpm test

# Original integration suite (private-key signer)
cd cli && pnpm test:integration

# New Speculos suite
cd cli && pnpm test:speculos

# Hardware Ledger suite (operator present)
cd cli && pnpm test:ledger
```

## §7 Debugging

| Symptom | First check |
|---------|-------------|
| `Speculos REST API not reachable` | Is docker running? `docker ps \| grep speculos`. Port 5000 free? |
| `Ledger app ELF not found` | Drop file into `cli/test/speculos/apps/nanox-ethereum.elf` or set `SOULVAULT_SPECULOS_APP_ELF`. |
| `ClearSignError code=UNSUPPORTED_SELECTOR` | CAL descriptor missing for the selector in strict mode. Either add a JSON under `cli/test/speculos/cal/` or switch that call to `clear-sign-preferred`. |
| `ClearSignError code=APP_INCOMPATIBLE` | Ethereum app too old. Update app; match the ELF version in `apps/`. |
| `waitForText: timed out after Xms` | Speculos text didn't render. Check the display contract in `typed-data.ts` matches what the device actually shows — Nano S truncates. |
| `No unlocked accounts` on funding | Local RPC does not expose `eth_accounts[0]` as funder. Use `anvil --unlocked-accounts` or set a funder key as `SOULVAULT_PRIVATE_KEY`. |

## §8 Known unverified checkpoints (this runbook)

Because this runbook was authored alongside the code without end-to-end execution, these steps are the explicit **validation gates** before calling the suite "green":

- [ ] `docker pull ghcr.io/ledgerhq/speculos:latest` succeeds (image tag may need pinning).
- [ ] Nano X Ethereum app ELF is procured and path works.
- [ ] `@ledgerhq/device-transport-kit-speculos` is either packaged or the `apduExchange` fallback is wired into `buildLedgerSignerEth`.
- [ ] Local ens-app-v3 node exposes funder account via `eth_accounts`.
- [ ] First `pnpm test:speculos` run passes at least `story08 — clear-signs SetTreasury via EIP-712`.
- [ ] First `pnpm test:ledger` run passes the same test with operator approval.

After each checkpoint, tick the box and commit the runbook update.
