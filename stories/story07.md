# Story 07 — Ledger signer: what signs, what does not

This story clarifies **when the Ledger shows nothing** versus **when it prompts** (address export or transaction signing), and how that fits **`organization create`**, **`sync`**, and on-chain flows.

Goal:
- avoid surprise when `organization create` completes with no Ledger UI
- know how to force an on-device **address** step
- know which commands first hit **transaction** signing

---

## 1) `organization create` is local-only

```bash
soulvault organization create --name myorg --ens-name myorg.eth --public
```

Behavior:

- Writes `~/.soulvault/organizations/<slug>.json` and updates `config.json`.
- Does **not** register ENS on-chain, deploy contracts, or broadcast any transaction.
- **No transaction signing** on the Ledger (nothing to sign).

If you pass `--name soulvault-ledger.eth` **without** `--ens-name`, the string is only the **display name** in the JSON profile; it is **not** treated as an ENS root until you set `--ens-name` and later run `organization register-ens`.

`ownerAddress` in the profile may be filled from `describeSigner()` (your Ledger account), but that path uses **silent address export** unless you enable confirmation (see §3).

---

## 2) `sync` is read-only on-chain

```bash
soulvault sync --organization-ens myorg.eth --swarm-ens ops.myorg.eth
```

Behavior:

- Reads ENS text records and RPC (owners, swarm `owner()`, etc.).
- Updates local org/swarm JSON under `~/.soulvault/`.
- **No transaction signing** — the Ledger stays idle except for whatever happens when the CLI **opens a session** (see §3).

---

## 3) Optional: Ledger prompt when exporting the address

By default the CLI may derive the account from the Ledger **without** asking you to approve on-device (`checkOnDevice` off).

To require a Ledger UI step when the CLI resolves the address, set in `.env`:

```bash
SOULVAULT_LEDGER_CONFIRM_ADDRESS=true
```

Then commands that call `describeSigner()` / `createSigner()` (e.g. `organization create`, `sync`) can show the device’s **export / confirm address** flow. Exact wording depends on Ledger app + firmware.

---

## 4) When you **do** get transaction signing

The Ledger prompts to **review and approve a transaction** when the CLI sends a chain write, for example:

- `soulvault organization register-ens` — ENS commit/register on Sepolia
- `soulvault swarm create` — deploy + ENS binding path (on-chain steps)
- `soulvault agent register` / identity updates — ERC-8004 adapter writes on Sepolia
- `soulvault swarm backup-request`, `approve-join`, epoch rotation, messaging posts, etc. — swarm contract on 0G

Use the normal bootstrap story for the full journey: see `story00.md` (profile → `register-ens` → `swarm create` → …).

---

## 5) Quick mental model

| Step | Touches chain? | Ledger tx signature? |
|------|----------------|----------------------|
| `organization create` | No | No |
| `sync` | Read-only | No |
| `organization register-ens` | Yes (Sepolia) | Yes |
| Swarm / agent on-chain commands | Yes | Yes |

---

## 6) Troubleshooting: `UnknownDeviceExchangeError` / `errorCode: 6a87`

Symptoms: CLI prints something like `UnknownDeviceExchangeError`, `Unexpected device exchange error`, or APDU `6a87` / `6a80` when running **any** command that opens a Ledger session (`sync`, `organization create`, on-chain txs, …).

This comes from the **device**, not from ENS or `sync` logic. Try in order:

1. **Ethereum app** — Unlock the Ledger, open **Ethereum**, stay on that app (not the device lock screen or “Bitcoin”, etc.).
2. **Exclusive access** — Fully quit **Ledger Live** and other wallets that might hold the USB/HID session.
3. **Updates** — In Ledger Live, update **device firmware** and the **Ethereum** app; mismatched app versions sometimes reject commands the stack sends.
4. **USB** — Direct motherboard port; avoid flaky hubs; try another cable.
5. **Derivation path** — `SOULVAULT_LEDGER_DERIVATION_PATH` should look like `m/44'/60'/0'/0/0`. The CLI strips the leading `m/`; stray quotes or typos in `.env` break path encoding.
6. **`6a80` / “cannot be clear-signed” on contract txs** — The Ethereum app may refuse Ledger’s “clear signing” payloads for selectors it does not know (e.g. ENS `commit`). SoulVault’s Ledger integration **skips tx clear-sign CAL contexts** so the device uses the generic signing path. If you still see prompts failing, open the **Ethereum** app on the device → **Settings** → enable **Blind signing** (required for some raw calldata flows on older stacks).

The CLI maps many of these failures to a longer hint message on stderr.

---

## See also

- `skills/soulvault/references/env.md` — `SOULVAULT_LEDGER_CONFIRM_ADDRESS`, `SOULVAULT_SYNC_*`, `SOULVAULT_LEDGER_AUTO_SYNC`
- `story00.md` — full bootstrap with ENS registration and swarm deploy
