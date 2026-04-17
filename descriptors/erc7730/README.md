# ERC-7730 Clear-Signing Descriptors

Canonical source of truth for SoulVault's Ledger clear-signing field display. These descriptors are what make the Ledger device show "Approve Fund · Request #42 · Amount 1.5 ETH · Recipient 0x…" instead of "Blind signing" + raw bytes.

## Layout

| File | Contract | Chain |
|------|----------|-------|
| `SoulVaultSwarm.json` | `contracts/ISoulVaultSwarm.sol` | 0G Galileo (16602) |
| `SoulVaultTreasury.json` | `contracts/ISoulVaultTreasury.sol` | 0G Galileo (16602) |
| `SoulVaultERC8004RegistryAdapter.json` | `contracts/SoulVaultERC8004RegistryAdapter.sol` | Sepolia (11155111) |

Each descriptor covers one contract's selectors with field labels and format hints (raw / amount-with-native-currency / addressName / date).

## Current status (2026-04-14)

**Upstream submission is intentionally deferred.** SoulVault's contract surface is still evolving — we are layering on features and do not want to open a PR with Ledger that we'll immediately invalidate with new selectors. See `docs/clear-signing-submission-runbook.md` for the full pre-submission gate + procedure.

Until submission lands:
- These JSON files are the canonical spec for Ledger display and stay in-repo.
- `pnpm test:speculos` runs with blind-sign auto-enabled; `cli/src/lib/__integration__/clear-sign-diagnostic.speculos.integration.test.ts` proves the signing pipeline works end-to-end and captures on-device screens.
- Hardware clear-sign is blind-sign mode for typed-data (field-by-field display only kicks in after Ledger CAL serves these descriptors).

## How they reach a device

Clear-signing descriptors cannot be self-serviced locally — the Ledger Ethereum app requires them to be signed by Ledger's authority key. Flow:

```
Repo JSON  ──PR──▶  LedgerHQ/clear-signing-erc7730-registry
                            │
                            ▼
                    Ledger review + sign
                            │
                            ▼
                      Ledger CAL backend
                            │
                            ▼
   @ledgerhq/context-module (DMK) fetches at sign-time
                            │
                            ▼
         User's Ledger renders field-by-field
```

See [`../../docs/clear-signing-submission-runbook.md`](../../docs/clear-signing-submission-runbook.md) for the submission checklist.

## Until upstream merges

Speculos integration tests (`pnpm test:speculos`) run with blind-signing enabled (auto-toggled by `cli/test/global-setup-speculos.ts`). They verify that signing **works** and **captures device screens**, but do not assert field-by-field labels until Ledger CAL serves our descriptors. When the upstream PR lands and rolls out, re-run the suites; the on-device display changes automatically and the existing tests graduate to field-by-field assertions without code changes (the `DISPLAY_CONTRACTS` in `cli/src/lib/typed-data.ts` already encode the expected labels).

## Deployment addresses

The `deployments[].address` fields are `0x0000…` placeholders. Update them before submission with:
- Mainnet / production deploy (0G Galileo) address for Swarm + Treasury
- Sepolia ERC-8004 adapter address

Local ens-app-v3 / anvil addresses are deterministic per test run — those don't need to be in the descriptor; Speculos testing relies on blind-sign rather than the registry.

## Validation

When Ledger's `erc7730-py` tool is available:
```bash
pip install erc7730
erc7730 lint descriptors/erc7730/SoulVaultSwarm.json
```
