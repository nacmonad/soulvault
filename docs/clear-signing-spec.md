# Clear-Signing Spec — SoulVault (EIP-712 + ERC-7730)

> **On-chain verification is LIVE.** Contracts inherit `EIP712` from OpenZeppelin and expose `*WithSig` variants for every owner action. Owner signs the EIP-712 intent on Ledger; any EOA (relayer / hot wallet / co-admin) submits the signed intent by calling the `*WithSig` selector with the signature. Replay protection = `ownerNonce` (monotonic, per-contract) + `deadline` (unix seconds). Details below in §11.



**Status:** proposed (2026-04-14)
**Scope:** Ledger clear-signing for all owner/admin transaction flows across SoulVault's two lanes (0G Galileo ops + Sepolia identity) and the local ens-app-v3 integration harness.
**Objective:** deterministic human-verifiable on-device display of signed intent, with 1:1 parity between Speculos automation and physical-device runs.

---

## 1. Principles (ERC-7730 aligned)

SoulVault signs **intents**, not opaque bytes. An intent is the union of:

- **Domain** — who is talking to whom (EIP-712 domain separator: name, version, chainId, verifyingContract)
- **Action discriminator** — a named struct like `SetTreasury`, `ApproveFundRequest`, `RotateEpoch`
- **Bounded, display-safe fields** — fixed primitives (addresses, uints, fixed-size bytes) where possible; free-form strings are hashed off-device and their hash is signed, with a short human label surfaced alongside
- **Replay bounds** — `chainId` (in domain), per-action `nonce`, and a `deadline` (uint64 unix seconds)

Non-negotiables:

1. **No cross-contract / cross-chain replay.** Every admin intent binds `verifyingContract` + `chainId` in the EIP-712 domain.
2. **No blind fallback in strict mode.** When a caller invokes `clear-sign: strict`, signing MUST fail loudly if the CAL context is unavailable for the target selector.
3. **Deterministic rendering contract.** Each action below enumerates the exact fields expected to appear on-device. Missing or ambiguous display in Speculos tests is a test failure.
4. **No plaintext secrets on-device or in logs.** Ephemeral keys, K_epoch, backup payloads never transit the signing path.

---

## 2. Signing modes

Implemented in `cli/src/lib/clear-sign-modes.ts` and selected per-call:

| Mode | Behavior | Use |
|------|----------|-----|
| `strict-clear-sign` | Fetch CAL context for transactions. If missing/empty for the selector, throw `CLEAR_SIGN_CONTEXT_UNAVAILABLE`. Never blind-sign. | Integration tests, paranoid production admin flows |
| `clear-sign-preferred` | Fetch CAL context when available. If unavailable, proceed with generic signing (device will show "blind sign" warning as normal). | Default for end-user CLI. |
| `blind-only` | Skip CAL fetch entirely (legacy behavior). | Explicit escape hatch for known-unsupported selectors (e.g. ENS `commit`) while a CAL descriptor is pending. |

Mode is resolved as follows:

1. Explicit argument to `signer.signTransaction(tx, { clearSign: 'strict' })` (highest priority).
2. Env var `SOULVAULT_LEDGER_CLEAR_SIGN_MODE` (applies to all tx).
3. Default: `clear-sign-preferred`.

The old `wrapContextModuleSkipTxClearSign` wrapper is **removed**; its behavior is now opt-in via `blind-only` per-call.

---

## 3. Error taxonomy

Signer errors are instances of `ClearSignError` with a discriminated `code`:

| Code | Meaning |
|------|---------|
| `UNSUPPORTED_SELECTOR` | CAL returned empty context for this selector in strict mode. |
| `CLEAR_SIGN_CONTEXT_FETCH_FAILED` | CAL server unreachable or returned error. |
| `USER_REJECTED` | Device reported user rejection (APDU 6985). |
| `APP_INCOMPATIBLE` | Ethereum app too old / missing feature (APDU 6e00, 6d00). |
| `INVALID_DATA` | Malformed payload rejected by device (APDU 6a80) in a non-CAL context. |
| `TIMEOUT` | Device action exceeded `LEDGER_ACTION_TIMEOUT_MS`. |
| `COMMUNICATION` | Lower-level DMK / HID / HTTP transport failure. |

These are stable and tested against both Speculos (fake APDU replies) and physical-device.

---

## 4. Canonical EIP-712 domains

Two production domains + one test domain:

```ts
// 0G Galileo swarm
{ name: "SoulVaultSwarm", version: "1", chainId: 16602,    verifyingContract: <swarmAddr> }

// 0G Galileo treasury
{ name: "SoulVaultTreasury", version: "1", chainId: 16602, verifyingContract: <treasuryAddr> }

// Local ens-app-v3 harness overrides chainId to 1337; everything else identical.
```

ENS registrations and ERC-8004 calls are **not** typed-data signed today — they are `signTransaction` calls whose calldata must still pass clear-sign display assertions (see §6).

---

## 5. Action schemas (typed-data)

Each struct includes `nonce` and `deadline` plus the action-specific fields. On-device display contract below each.

### 5.1 `SetTreasury`

```
SetTreasury(address swarm, address treasury, uint64 nonce, uint64 deadline)
```

Display contract:
- "Action: Set Treasury"
- "Swarm: 0x<short8>…<last6>"
- "Treasury: 0x<short8>…<last6>"
- "Deadline: <UTC ISO>"

### 5.2 `ApproveFundRequest` / `RejectFundRequest`

```
ApproveFundRequest(address swarm, uint256 requestId, uint256 amount, address recipient, uint64 nonce, uint64 deadline)
RejectFundRequest(address swarm, uint256 requestId, bytes32 reasonHash, uint64 nonce, uint64 deadline)
```

Display:
- "Action: Approve Fund" / "Reject Fund"
- "Swarm: 0x…"
- "Request #: <requestId>"
- "Amount: <ETH>" (approve only; formatted wei→ETH, 6dp)
- "Recipient: 0x…" (approve only)
- "Reason hash: 0x…" (reject only; full reason shown off-device during prep)
- "Deadline: <UTC ISO>"

### 5.3 `RotateEpoch`

```
RotateEpoch(address swarm, uint64 fromEpoch, uint64 toEpoch, bytes32 bundleManifestHash, uint64 nonce, uint64 deadline)
```

Display: "Action: Rotate Epoch", "Swarm", "From → To", "Bundle hash", "Deadline".

### 5.4 `ApproveJoin` / `RejectJoin` / `RemoveMember`

```
ApproveJoin(address swarm, uint256 requestId, address requester, uint64 nonce, uint64 deadline)
RejectJoin(address swarm, uint256 requestId, address requester, bytes32 reasonHash, uint64 nonce, uint64 deadline)
RemoveMember(address swarm, address member, uint64 nonce, uint64 deadline)
```

### 5.5 `BackupRequest`

```
BackupRequest(address swarm, uint64 epoch, bytes32 trigger, uint64 nonce, uint64 deadline)
```

### 5.6 `TreasuryWithdraw`

```
TreasuryWithdraw(address treasury, address recipient, uint256 amount, uint64 nonce, uint64 deadline)
```

### 5.7 `TreasuryDeposit`

Deposit is an unprivileged `payable` call — no typed-data, but still must display clearly: Action, Treasury, Amount.

---

## 6. Selectors requiring CAL descriptors (non-typed-data flows)

These are plain contract calls where clear-sign depends on a CAL descriptor being available on Ledger's backend or injected locally via Speculos mock CAL:

| Contract | Selector | Function | Required display |
|----------|----------|----------|------------------|
| ENSRegistry | `commit(bytes32)` | register ENS name, step 1 | **Known unsupported on Ledger CAL today.** Use `blind-only` mode; documented in limitations. |
| ENSRegistry | `register(...)` | register ENS name, step 2 | Name, owner, duration. CAL descriptor required. |
| ERC-8004 adapter | `register(string,string)` | agent identity mint | Manifest URI (hash), resolver. |
| SoulVaultSwarm | `requestJoin` | agent joins | Swarm, pubkey (hash), metadata ref. |
| SoulVaultSwarm | `approveJoin(uint256)` | owner approves | Swarm, requestId, requester. |
| SoulVaultSwarm | `setTreasury(address)` | owner binds | Swarm, treasury. |
| SoulVaultSwarm | `rotateEpoch(...)` | owner rotates | Swarm, from→to, bundle hash. |
| SoulVaultSwarm | `requestBackup()` | owner triggers | Swarm, epoch. |
| SoulVaultSwarm | `requestFunds(uint256,string)` | member requests | Swarm, amount, reason hash. |
| SoulVaultSwarm | `cancelFundRequest(uint256)` | member cancels | Swarm, requestId. |
| SoulVaultTreasury | `deposit()` | anyone deposits | Treasury, amount. |
| SoulVaultTreasury | `approveFundRequest(address,uint256)` | owner approves | Treasury, swarm, requestId. |
| SoulVaultTreasury | `rejectFundRequest(address,uint256,string)` | owner rejects | Treasury, swarm, requestId, reason hash. |
| SoulVaultTreasury | `withdraw(address,uint256)` | owner withdraws | Treasury, to, amount. |

For each row, the repo ships a real ERC-7730 descriptor at `descriptors/erc7730/<contract>.json` for upstream submission to Ledger's CAL. Until that PR merges and propagates, Speculos tests run in blind-sign mode (auto-enabled in globalSetup) and rely on screen-capture assertions. See `docs/clear-signing-submission-runbook.md`.

---

## 7. Replay-resistance contract

- **Nonce:** for typed-data actions, nonce is drawn from the target contract's view (`nonces(signer)`) when applicable; otherwise a per-action signer-local monotonic counter stored under `~/.soulvault/nonces/<chainId>-<contract>.json`.
- **Deadline:** default `now + 15m` for interactive CLI flows; configurable per command. Contracts MUST reject `block.timestamp > deadline`.
- **Action discriminator** is the struct name, which is part of the EIP-712 typehash; a signature for `ApproveFundRequest` cannot be replayed as `RejectFundRequest`.

---

## 8. Testing determinism

**Speculos side**
- Ledger Nano S+ / Nano X app ELF provisioned under `cli/test/speculos/apps/`.
- Fixed 24-word seed committed to `cli/test/speculos/seed.txt` (test-only; no production use).
- Docker container started by vitest globalSetup; APDU HTTP endpoint on `127.0.0.1:5000`, screen HTTP on `127.0.0.1:5001`.
- Button automation via `/button/left|right|both` endpoints.
- Screen assertions: each test asserts an ordered sequence of visible strings from `/screenshot` → OCR or `/events`.

**Hardware side**
- Same test file structure, same seed derivation path (user-provisioned test device).
- Screen assertions become human checklist rendered to the test report; pass/fail confirmed by driver prompt.

**Parity enforcement**
Each action has a single "display contract" constant shared between Speculos and hardware tests. Divergence between what Speculos automation asserts and what the hardware checklist prompts is a test-suite bug.

---

## 9. Funding determinism

Local tests assume `http://127.0.0.1:8545` ens-app-v3 chain. `beforeAll` for every suite:

1. Connect account `[0]` via JSON-RPC (no signer needed; eth_accounts unlocked).
2. Resolve Ledger/Speculos owner address via `signerEth.getAddress(path)`.
3. If balance < `MIN_OWNER_BALANCE` (default 10 ETH), transfer `FUND_TOPUP` (20 ETH) from `[0]`.
4. Also top-up secondary member accounts used by the suite.
5. Assert post-fund balance ≥ threshold; fail fast otherwise.

Constants are declared in `cli/test/speculos/funding.ts` and reused by hardware suites.

---

## 10. Known limitations at spec time

- Ledger Ethereum app CAL does not ship a descriptor for ENSRegistry `commit(bytes32)`. Workaround: `blind-only` mode with an explicit display-contract checklist for the pre-image. Tracked in `docs/clear-signing-limitations.md`.
- ERC-8004 adapter is custom; no public CAL descriptor. Local speculos uses mock CAL.
- 0G Galileo chain (16602) is not a Ledger-recognized chainId for display metadata — the device shows "Unknown chain 16602". We accept this for ops-lane signing; the display contract still asserts chainId **value**.
- Typed-data v4 display on Nano S is truncated for some fields; we keep field labels ≤ 16 chars where possible.

---

## 11. On-chain signature verification (dual-path architecture)

SoulVault contracts accept admin actions via **two** authorization paths, by design:

### Path A — EOA direct (backwards-compat)

```
owner EOA ──(call)──> contract.approveFundRequest(swarm, id)
                     ├── require(msg.sender == owner)
                     └── core logic
```

- Ledger signs the raw tx (calldata shown on-device).
- Works today without descriptors; display quality depends on CAL.
- One signature, one on-device approval.

### Path B — Signed intent (the clear-sign path)

```
owner's Ledger ──(EIP-712 sign)──> sig
                                     │
anyone (relayer / hot wallet) ──(call with sig)──> contract.approveFundRequestWithSig(..., sig)
                                                    ├── verify EIP-712(owner, nonce, deadline)
                                                    ├── consume ownerNonce++
                                                    └── core logic
```

- Ledger shows field-by-field via ERC-7730 descriptor (once live in CAL; blind-signed until then).
- Submitter can be anyone with gas — owner's hot wallet, a relayer service, a swarm co-admin, an ERC-4337 bundler, etc.
- Relayer does NOT become privileged by submitting; they can only submit intents the owner already signed.

### Replay + freshness guarantees

Every `*WithSig` call enforces:
- `block.timestamp <= deadline` — stale signatures expire.
- `nonce == ownerNonce` — each signature consumes exactly one nonce; replayed sigs revert `BadNonce`.
- `ECDSA.recover(digest, sig) == owner` — only the owner's secp256k1 key can authorize.
- Bound parameters (e.g. `requester`, `amount`, `recipient`) are re-checked against live contract state to block stale-signature exploits across parameter changes.

### Contract → typehash map

| Contract | Selector | Typehash struct |
|---|---|---|
| SoulVaultSwarm | `approveJoinWithSig` | `ApproveJoin(address swarm,uint256 requestId,address requester,uint64 nonce,uint64 deadline)` |
| SoulVaultSwarm | `rejectJoinWithSig` | `RejectJoin(address swarm,uint256 requestId,address requester,bytes32 reasonHash,uint64 nonce,uint64 deadline)` |
| SoulVaultSwarm | `removeMemberWithSig` | `RemoveMember(address swarm,address member,uint64 nonce,uint64 deadline)` |
| SoulVaultSwarm | `setTreasuryWithSig` | `SetTreasury(address swarm,address treasury,uint64 nonce,uint64 deadline)` |
| SoulVaultSwarm | `rotateEpochWithSig` | `RotateEpoch(address swarm,uint64 fromEpoch,uint64 toEpoch,bytes32 bundleManifestHash,uint64 nonce,uint64 deadline)` |
| SoulVaultSwarm | `requestBackupWithSig` | `BackupRequest(address swarm,uint64 epoch,bytes32 trigger,uint64 nonce,uint64 deadline)` |
| SoulVaultTreasury | `approveFundRequestWithSig` | `ApproveFundRequest(address swarm,uint256 requestId,uint256 amount,address recipient,uint64 nonce,uint64 deadline)` |
| SoulVaultTreasury | `rejectFundRequestWithSig` | `RejectFundRequest(address swarm,uint256 requestId,bytes32 reasonHash,uint64 nonce,uint64 deadline)` |
| SoulVaultTreasury | `withdrawWithSig` | `TreasuryWithdraw(address treasury,address recipient,uint256 amount,uint64 nonce,uint64 deadline)` |

These typehash strings match `cli/src/lib/typed-data.ts` exactly — if you change one, change both.

### Test coverage

- **Foundry** — `test/WithSig.t.sol`: 9 tests covering happy, bad-signer, expired, bad-nonce, replay, different-submitter, end-to-end fund-request flow.
- **Speculos** — stories 00/03/04/08 sign via Ledger and submit via `funder` (anvil[0] as relayer), asserting real on-chain state change (member added, epoch rotated, backup event emitted, funds transferred).
- **Hardware** — identical tests against physical Ledger; operator confirms each intent on-device.

### Relayer choices for production

| Submitter | Best for |
|---|---|
| Owner's hot wallet (CLI key) | Single-owner deployments; simplest UX |
| OpenZeppelin Defender / custom bot | Gasless UX; owner holds no native token |
| Safe / ERC-4337 SCW + paymaster | Fully abstracted UX; co-signing; batching |
| Another swarm member | Matches multi-agent architecture |

Submitter compromise is bounded — they can only submit intents the owner has already signed. See `docs/clear-signing-runbook.md` §9 for the production relayer setup checklist.
