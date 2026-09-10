# SoulVault deployer-factory → Ledger CAL registration

## Problem

SoulVault contracts are user-deployed, so every deploy publishes fresh
addresses. Ledger's Clear Asset Listing (CAL) keys clear-signing descriptors on
**contract address + selector**, so unlisted user-deployed contracts get
blind-sign prompts: the Ethereum app renders the raw ABI walk — one screen per
parameter, one screen per dynamic-array element. Consequences:

- `publishDocument(docHash, slotIds[])` with N slots is one tx / one signature,
  but the device walks N+ screens ("feels like" N signatures).
- Every SoulVault selector shows as opaque data — no human-readable "Publish
  document, 12 slots" summary.
- Multi-step flows (deploy → ENS announce → list) require one device
  confirmation per tx with full parameter walks each time.

## Direction

Ship an **audited SoulVault deployer-factory contract** with fixed, known
addresses:

1. Users deploy org/swarm/treasury/registry contracts **through the factory**
   (CREATE2 or plain CREATE from a singleton the Ledger team can verify).
2. Fixed addresses (factory + deterministic child addresses) become
   CAL-registerable: submit descriptors to Ledger's CAL
   (developers.ledger.com) so the device renders SoulVault-specific,
   human-readable clear-signing screens.
3. The factory also enables **batched multi-step flows** — e.g. deploy +
   initial ENS-bound setup in one user signature — and composes with the
   EIP-7702 batch-executor ticket (017).

## Non-goals / constraints

- The registry swarm/treasury lane already supports user-owned deployments;
  the factory is a signing-UX layer, not a custody change. Users keep
  ownership; the factory only standardizes the deployment path and address
  derivations.
- CAL approval is a Ledger-side process — the factory must be verified +
  audited before submission. Until then, blind-sign + hash verification
  (DevicePromptPanel in every wizard) is the trust model.
- Do not mangle event/ABI shapes (e.g. flattening `string[] slotIds` into a
  delimited string) to shorten the device walk — the event log is the
  machine-readable contract for consumers.

## Acceptance criteria

- [ ] Factory contract deployed to Sepolia (then mainnet), address announced
      via the protocol root ENS records alongside the registry.
- [ ] All SoulVault user deployments route through the factory (new deploys;
      existing contracts keep working as-is).
- [ ] CAL descriptor submission prepared for factory + SoulVault selectors.
- [ ] Wizards render the human-readable prompt when CAL descriptors are live,
      keeping the hash panel as fallback for undeployed/unlisted addresses.
