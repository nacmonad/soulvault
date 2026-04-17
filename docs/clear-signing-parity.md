# Clear-Signing Parity Matrix

1:1 mapping between Speculos automation (`*.speculos.integration.test.ts`) and hardware-manual (`*.ledger.integration.test.ts`) suites. Each row is a signed intent. "Speculos" and "Hardware" columns are the test-case IDs (`it(...)` titles) that must stay in lockstep.

| Story | Intent | Mode | EIP-712 struct | Speculos test | Hardware test | Unavoidable divergence |
|-------|--------|------|----------------|---------------|---------------|------------------------|
| 00 | approveJoin | clear-sign-preferred | ApproveJoin | `approveJoin: clear-sign preferred mode displays swarm + requestId + requester` | `approveJoin displays swarm/requestId/requester` | none |
| 00 | ENS commit | blind-only | — (no CAL descriptor) | `ENS commit uses blind-only mode (documented CAL gap)` | `ENS commit blind-only path works on hardware` | Device shows "Blind signing" warning; display contract is operator-verified on hardware, regex-verified on Speculos. |
| 00 | negative auth | — | ApproveJoin | `negative: non-owner approveJoin reverts` | (same; no device interaction) | Pure revert check — no parity issue. |
| 02 | ERC-8004 register | clear-sign-preferred | — (CAL selector) | `register displays manifest URI + resolver` | `register displays manifest URI + resolver` | Needs mock CAL in Speculos; hardware uses public Ledger CAL if descriptor published, else falls back to blind. |
| 02 | duplicate register | — | — | `negative: duplicate register reverts` | (same) | none |
| 03 | rotateEpoch | strict-clear-sign | RotateEpoch | `rotateEpoch strict clear-sign: displays from→to + bundle` | `rotateEpoch strict clear-sign displays intent` | Nano S truncates bundle hash display; Speculos Nano X has full width. We assert the short-form (first 10 + last 6 chars). |
| 03 | non-owner rotate | — | — | `negative: non-owner rotateEpoch reverts` | (same) | none |
| 04 | backup request | clear-sign-preferred | BackupRequest | `backup request displays swarm + epoch + trigger` | `backup request displays intent` | none |
| 08 | setTreasury | clear-sign-preferred | SetTreasury | `clear-signs SetTreasury via EIP-712` | `clear-signs SetTreasury via EIP-712` | none |
| 08 | approveFundRequest | strict-clear-sign | ApproveFundRequest | `owner approves fund request with strict clear-sign` | `owner approves fund request with strict clear-sign` | none |
| 08 | non-owner approve | — | — | `negative: non-owner approveFundRequest reverts unauthorized` | (same) | none |
| 08 | double approve | — | — | `negative: double approve reverts` | (hardware-suite-subset) | none |
| 08 | strict without CAL | — | — | `ClearSignError surfaces when strict mode lacks CAL` | (hardware-suite-subset) | Hardware only runs if a real CAL descriptor is missing for the selector; otherwise skip. |

## Sources of unavoidable divergence

1. **Device model screen width.** Nano S truncates long labels and hashes; Nano X / Stax show more. Display contract uses short-form strings (`0x12345678…abcdef`) so both pass.
2. **CAL availability.** Speculos serves local mock CAL from `cli/test/speculos/cal/`. Hardware depends on Ledger's production CAL backend. When a selector is unknown to production CAL, hardware forces `clear-sign-preferred` → blind fallback; the operator checklist documents expected raw bytes.
3. **Chain metadata.** 0G Galileo (16602) is unknown to the Ledger Ethereum app; device shows "Unknown chain 16602". Both suites assert this exact string.
4. **Interactive timing.** Speculos button presses are instantaneous. Hardware tests gate on an operator prompt. Test timeouts (`testTimeout`) are generous (300s for both suites) to absorb this.

## How parity is enforced

- Both suites import `DISPLAY_CONTRACTS` from `cli/src/lib/typed-data.ts`. The helper `assertPayloadDisplay(payload, runtime)` renders the same list of fragments in both modes.
- CI runs `pnpm test:speculos` on every PR. Hardware suite is a scheduled release-gate job triggered manually with the operator present.
- When adding a new admin intent, the spec contract in `typed-data.ts` must be updated before either test suite — a PR that changes only one side fails review.
