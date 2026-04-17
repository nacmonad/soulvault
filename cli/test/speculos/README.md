# Speculos Test Harness

Deterministic Ledger clear-sign emulation using [Speculos](https://github.com/LedgerHQ/speculos).
See `docs/clear-signing-runbook.md` for the full setup walkthrough.

## Files

| File | Purpose |
|------|---------|
| `docker.ts` | Start/stop ghcr.io/ledgerhq/speculos container with Nano X app ELF. |
| `screen.ts` | Poll `/events` + `/screenshot` for on-device text assertions. |
| `buttons.ts` | Press left/right/both via `/button` REST endpoint. |
| `transport.ts` | DMK transport adapter that forwards APDUs to Speculos `/apdu`. |
| `funding.ts` | Deterministic funder: top-up owner + secondary accounts from local account[0]. |
| `../../../descriptors/erc7730/*.json` | **Real** ERC-7730 descriptors (source of truth; submitted upstream to Ledger CAL). See `docs/clear-signing-submission-runbook.md`. |
| `apps/` | (gitignored) Nano X app ELF — user-provisioned. |
| `seed.txt` | Test-only BIP39 seed (24 words). Do NOT fund on mainnet. |

## Test-only seed

```
test test test test test test test test test test test junk
```
(12-word variant; 24-word fallback in `seed.txt`). Same seed used across Speculos and any paired hardware test device operated in "test seed" mode.

## Required artifacts before running

1. Pull speculos image: `docker pull ghcr.io/ledgerhq/speculos:latest`
2. Drop the Ethereum app ELF at `cli/test/speculos/apps/nanox-ethereum.elf`. See runbook §2.
3. `pnpm install` (pulls `@ledgerhq/device-transport-kit-speculos` if/when wired into package.json).
4. Start local ens-app-v3 RPC on `127.0.0.1:8545`.
5. `pnpm test:speculos`.

Missing artifacts cause globalSetup to fail loudly with a remediation message.
