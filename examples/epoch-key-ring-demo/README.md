# IRL demo — real Ledger Key Ring (no LocalDevRing)

Records the epoch-key-ring recovery flow with **real LKRP**: every
encrypt/decrypt goes through Ledger's `wallet-cli ring` binary. Only the
escrow framing (plaintext header) and the "agent dies" step are scripted —
that framing is SoulVault's layer, per `docs/epoch-key-ring-spec.md`.

## What you need at home

- Ledger device connected + unlocked (Ethereum app not required for ring ops)
- Ledger Sync signed in on your phone (trustchain pairing, one-time)
- `npm i -g @ledgerhq/wallet-cli`

## Run

```bash
node irl-demo.mjs               # full flow, incl. one-time `ring init` (device tap)
node irl-demo.mjs --skip-init   # machine already enrolled from a previous run
```

## What the recording should show

1. **Enrollment** — `wallet-cli ring init`: device approval on the Ledger
   screen + Ledger Sync pairing. *The only hardware tap in the whole flow.*
2. **Escrow** — `wallet-cli ring encrypt` under
   `soulvault:epoch-recovery:charlie.ops.soulvault-ensv2.eth:epoch-000003`,
   then the escrow (header + body) lands in `storage/`.
3. **Die** — local plaintext wiped.
4. **Restore** — `wallet-cli ring decrypt` with the keyName read from the
   header. No device touch. Byte-identical markdown comes back.

## Note on cycle-path (--scan)

The cycle path (sweeping epoch names via GCM auth) needs derive access that
today's `wallet-cli ring` doesn't expose (it derives internally and never
hands out raw key bytes). For the IRL recording, the fast path is the demo;
the sweep stays proven in the simulated demo (`node demo.mjs`). If Ledger's
LKRP SDK exposes derivation later, the sweep moves to real hardware too.

## Storage

`storage/` is a local stand-in for 0G. Production path: same escrow
(header + body) uploaded to 0G next to the backup bundle.
