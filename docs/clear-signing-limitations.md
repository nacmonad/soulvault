# Clear-Signing Known Limitations Register

Tracked constraints that affect whether a given SoulVault admin call can be clear-signed today. Each entry has: what, why, workaround, resolution owner, review date.

## Ledger Ethereum app — firmware/app matrix

| Component | Minimum tested | Known blockers |
|-----------|----------------|----------------|
| Ledger firmware | Nano X 2.2.3 / Nano S+ 1.1.1 | Typed-data v4 field-by-field filtering lands only in app ≥ 1.10.1. Older apps show raw hash. |
| Ethereum app | 1.10.1 | Before 1.10.1 the app falls back to blind signing for any typed-data struct without embedded filter DER. |
| CAL backend | production | Unknown selectors trigger 6a80 in strict mode; preferred mode silently blinds. |

## Selectors without CAL descriptors

These are known to NOT have a Ledger-published CAL descriptor and therefore require either local mock CAL (Speculos) or `blind-only` mode (hardware):

| Contract | Selector | Why |
|----------|----------|-----|
| ENSRegistryWithFallback / ETHRegistrarController | `commit(bytes32)` | ENS commit hashes are not decodable — by design the commitment blinds the intent. |
| SoulVaultERC8004RegistryAdapter | `register(string,string)` | Custom contract; no upstream CAL submission yet. |
| SoulVaultSwarm | all owner writes | Custom contract; upstream CAL submission pending (see issue tracker). |
| SoulVaultTreasury | all owner writes | Same. |

**Resolution path:** Submit ERC-7730 descriptors to `github.com/LedgerHQ/clear-signing-erc7730-registry`. Until merged, Speculos uses `cli/test/speculos/cal/*.json` and hardware documents expected bytes in the operator checklist.

## Chain metadata

0G Galileo (chainId `16602`) is not in Ledger's well-known chain list. On-device display shows "Unknown chain 16602" for any ops-lane transaction. Both test suites assert this exact string — do not treat it as a bug unless/until 0G chain metadata is accepted upstream.

## Nano S screen truncation

The Nano S (not S+) has a 96×16 OLED that truncates strings ≥ ~16 chars. Display contracts use short-form (`0x12345678…abcdef`) so they fit. If a new action needs long-form display, it must either be Nano S+/X-only or redesigned to hash the long value off-device.

## Speculos-only gaps

- **No "real" CAL fetch.** Speculos ships with a static file CAL; production Ledger fetches descriptors from the CAL backend at sign time. A Speculos test that passes does NOT guarantee the descriptor is live in production CAL.
- **VNC/headless display.** Some assertion paths OCR the screen rather than using `/events`. OCR is brittle; prefer `/events` where possible.

## Hardware-only gaps

- **Timing.** Human-in-the-loop tests can stall indefinitely; CI should never run `pnpm test:ledger`.
- **App install drift.** If the operator upgrades the Ethereum app mid-suite, APDU semantics can shift; pin the version in `.env.ledger.test` with `SOULVAULT_LEDGER_APP_VERSION` and have the harness verify at `getAppAndVersion` time (TODO).

## Upstream CAL submission — DEFERRED

**As of 2026-04-14:** descriptors are authored at `descriptors/erc7730/` but intentionally not yet submitted to `LedgerHQ/clear-signing-erc7730-registry`. Reason: the SoulVault contract surface is still in active feature development; a premature submission would require multiple follow-up PRs every time a selector changes.

Effect on the integration test suites:
- Typed-data actions (`ApproveFundRequest`, `SetTreasury`, `RotateEpoch`, etc.) signed via Speculos or hardware trigger the device's "Blind signing ahead" warning first, then render raw typed-data without our intent/label schema.
- Tests accept this: `clear-sign-diagnostic.speculos.integration.test.ts` walks through the warning, captures the screens, and asserts only that a real signature is produced.
- Story-level assertions against `DISPLAY_CONTRACTS` labels (e.g. "Approve Fund", "Request #42") will not match until the descriptors are live in CAL.

Graduation trigger: see `docs/clear-signing-submission-runbook.md` pre-submission checklist. When every item is green AND the contract surface is stable, file the upstream PR; on merge + rollout, re-run `pnpm test:ledger` to confirm field-by-field display.

## Resolved / not-in-scope

- **Solana / other chains:** out of scope; `getSolanaContext` is passthrough to inner.
- **Typed-data v3 (legacy):** SoulVault ships only EIP-712 v4.

## Review cadence

This file is reviewed whenever:
- Ledger Ethereum app releases a new major version.
- A new SoulVault admin intent is added to `typed-data.ts`.
- An upstream CAL descriptor is accepted (move the row out of "without CAL descriptors").
