# ERC-7730 Descriptor Submission Runbook

> **STATUS: DEFERRED (as of 2026-04-14).** Do NOT open the upstream PR yet. The SoulVault contract surface is still evolving (more features + admin intents being layered in); submitting premature descriptors forces an update-churn cycle with Ledger's review team for every selector that changes. This runbook captures the full procedure so when the contracts are feature-complete, the submission is a single focused effort.
>
> **Current posture in the meantime:**
> - `descriptors/erc7730/*.json` are kept in-repo, maintained alongside contract changes.
> - Speculos tests use **blind-signing + screen capture** (see `clear-sign-diagnostic.speculos.integration.test.ts`). Signatures are real; on-device display is the generic blind-sign warning + raw typed-data rendering, captured and logged by the walker.
> - Hardware tests (`pnpm test:ledger`) use the same posture; operator confirms on physical device.
> - **Graduation trigger:** when the merge in §7 completes, re-run `pnpm test:ledger` to confirm field-by-field display and then proceed with §8 (strict mode + cleanup).

Gets SoulVault's descriptors from this repo into Ledger's CAL so every hardware Ledger user sees field-by-field clear-signing for SoulVault transactions without blind-sign mode.

## Pre-submission checklist (run BEFORE opening the upstream PR)

The PR will be rejected or require rework if any of these slip. Treat each as a gate.

- [ ] **Contract surface is feature-frozen for this release cut.** No planned additions/removals/renames of owner-only selectors for the next ~4 weeks (typical Ledger review window).
- [ ] **All admin selectors are covered** in the matching descriptor. Audit: `grep -E "^    function [a-zA-Z]" contracts/I*.sol` vs `jq '.display.formats | keys' descriptors/erc7730/*.json`.
- [ ] **Deployment addresses are production, not `0x0000…`.** Swarm + Treasury on 0G Galileo (16602); ERC-8004 adapter on Sepolia (11155111) — or wherever the production target is at submission time.
- [ ] **Block explorers show verified source** for every deployment address in the descriptors.
- [ ] **Labels fit Nano S width** (≤16 chars). Run `jq '[.display.formats[].fields[]?.label] | map(select(length>16))' descriptors/erc7730/*.json` — should return `[]`.
- [ ] **Lint passes.** `pip install erc7730 && erc7730 lint descriptors/erc7730/*.json` returns 0.
- [ ] **Hardware smoke-test in `clear-sign-preferred` mode** still renders blind-sign fallback for now (descriptor absent in CAL), but signatures succeed. This is the pre-submission baseline.
- [ ] **Spec doc updated** (`docs/clear-signing-spec.md` §6) with any new selectors added since last sync.
- [ ] **Parity matrix updated** (`docs/clear-signing-parity.md`) for new intents.

## When to revisit

Triggers to re-open this runbook:
- A major feature release that adds persistent admin selectors (e.g., a new treasury operation, quorum upgrade)
- External partners integrating SoulVault want native clear-signing
- Ledger publicly announces faster review for community descriptors

Until one of those, stay with the current blind-sign-plus-screen-capture posture.

## Prerequisites

1. Descriptors at `descriptors/erc7730/*.json` are polished and their `deployments[].address` fields point at real production contract addresses (not `0x0000…`).
2. Contracts are verified on a block explorer that Ledger indexes (Etherscan-family). For 0G Galileo (16602), the explorer URL must be reachable.
3. A GitHub account with fork access to `LedgerHQ/clear-signing-erc7730-registry`.
4. `erc7730-py` linter installed: `pip install erc7730`.

## Step-by-step

### 1. Local validation

```bash
for f in descriptors/erc7730/*.json; do
  erc7730 lint "$f" || { echo "LINT FAILED: $f"; exit 1; }
done
```

Fix any schema complaints before opening a PR. Common issues:
- Path references that don't resolve against the ABI at the given deployment address
- `format: amount` without `params.nativeCurrency` or `params.token`
- Missing `required` for fields critical to the signed intent

### 2. Fork + branch

```bash
gh repo fork LedgerHQ/clear-signing-erc7730-registry --clone
cd clear-signing-erc7730-registry
git checkout -b soulvault/initial-submission
```

### 3. Place files in registry layout

The registry's `registry/` is organized by contract owner. Create:

```
registry/soulvault/
├── SoulVaultSwarm.json
├── SoulVaultTreasury.json
└── SoulVaultERC8004RegistryAdapter.json
```

Copy from this repo:

```bash
cp ../soulvault/descriptors/erc7730/*.json registry/soulvault/
```

### 4. Confirm linter + test flow pass upstream

```bash
# Registry repo ships its own CI config; run whatever it documents in CONTRIBUTING.
```

### 5. PR

```bash
git add registry/soulvault
git commit -m "Add SoulVault clear-signing descriptors

Covers SoulVaultSwarm (0G Galileo 16602), SoulVaultTreasury
(0G Galileo 16602), and SoulVaultERC8004RegistryAdapter (Sepolia
11155111). Intent labels + field formats derived from
https://github.com/nacmonad/soulvault/blob/main/docs/clear-signing-spec.md"
git push origin soulvault/initial-submission
gh pr create --repo LedgerHQ/clear-signing-erc7730-registry \
  --title "Add SoulVault descriptors" \
  --body "..."
```

PR body should include:
- Link to contract source + spec doc in this repo
- Confirmation of deployment addresses + explorer links
- Screenshots of Speculos display for each major action (captured via our `clear-sign-diagnostic.speculos.integration.test.ts`)

### 6. Review loop

Ledger triages in ~1–2 weeks. They may request:
- Tightened `required` field lists
- Shorter labels for Nano S width
- Split formats per contract version

Iterate until approved.

### 7. Post-merge rollout

Once merged, Ledger publishes to CAL. Typical propagation:
- **Production CAL backend**: hours
- **Reaching end-user Ledger Live / DMK clients**: no client change needed — clients fetch at sign-time

To verify from this repo:
```bash
# Run the diagnostic on hardware; it should render fields WITHOUT blind-sign enabled
pnpm test:ledger
```

### 8. Remove blind-sign crutch

Once field-by-field renders on hardware, we can:
1. Set `SOULVAULT_LEDGER_CLEAR_SIGN_MODE=strict-clear-sign` as the default in production.
2. Remove `enableBlindSigning()` from `cli/test/global-setup-speculos.ts` (or leave it as fallback for ENS commit only).
3. Upgrade story tests from "signature produced" assertions to "display contract matched" assertions (driven by `DISPLAY_CONTRACTS` in `cli/src/lib/typed-data.ts`, which already encodes the expected labels).

## What to do when contracts change

1. Update the descriptor JSON in this repo.
2. Bump the `metadata.info.lastUpdate` date.
3. Submit a follow-up PR to the registry.

Contract owners can usually update their own files without re-triage, but selector additions always need Ledger review.

## Known constraints

- **Chain support.** Ledger's clear-signing pipeline supports well-known chains natively. 0G Galileo (16602) is not yet in their chain registry — the initial PR may need to include a chain metadata addition, or the descriptors may initially only cover the Sepolia surface (ERC-8004).
- **Nano S truncation.** Labels >16 chars truncate. The current descriptors respect this; double-check at lint time.
- **Typed-data v4 only.** If any SoulVault flow moves to EIP-5267 / v5 typed data, descriptors need separate filter sections.
