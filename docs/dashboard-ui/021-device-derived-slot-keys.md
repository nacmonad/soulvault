# 021 — Device-derived deterministic slot keys (Ledger Key Ring / OpenPGP)

Status: idea, parked. Demo ships localStorage slot keys + run archival (see `document-session.ts`).

## Problem

Slot keys are random per redact run and live only in the author's browser localStorage.
Re-running Redact rotates every key under the same docHash (slotIds are deterministic;
`documentId` hashes only the public artifact), so grants from a prior run can never open
the current bundle. Recovery depends entirely on the browser session surviving.

## Goal

Derive slot keys deterministically from the author's Ledger seed so that:
- the same (docId, slotId, plaintext) always yields the same key, on any machine;
- recovery is "restore the seed", not "have the right browser profile";
- wire format is unchanged (derivation is author-side only; `encryptedSlots`,
  `SlotKeyGranted` events, and consumers are untouched).

## KDF scheme (wire-format neutral)

One device-derived master secret `ringSecret`, then local HKDF expansion:

```
key   = HKDF-SHA256(ringSecret, salt="soulvault-slot-key-v1",
                    info = docId || slotId || SHA-256(plaintext))
nonce = HKDF-SHA256(ringSecret, salt="soulvault-slot-nonce-v1",
                    info = docId || slotId || SHA-256(plaintext))[0..12]
```

The plaintext-hash binding prevents AES-GCM nonce reuse across redact runs of the same
document (the exact bug class from the `AUTHENTICATION_FAILED` saga).

## Path A — Ledger Key Ring Protocol (preferred; prize-aligned)

- LKRP lives in `LedgerHQ/ledger-live` (`libs/hw-ledger-key-ring-protocol` + `libs/ledger-key-ring-protocol`, Apache-2.0, monorepo-private). Derivation tree: `m / 0' / {applicationId}' / {rotationIndex}'` — `16` = Ledger Sync, `17` = wallet-cli. A SoulVault host would need its own application branch (Ledger-assigned ID — coordinate via issue/PR).
- SDK is dependency-injected for the device: `getSdk(isMockEnv, context, withDevice)` — the only device surface is the `Device` interface (`ApduDevice`/`SoftwareDevice`). A browser transport (`@ledgerhq/hw-transport-webusb`/`webhid`, or a DMK web transport adapter — we already ship `@soulvault/dmk-speculos-browser`) can drive it. Crypto layer is noble-based (isomorphic); `create-hmac` is the only Node-flavored dep (standard shim).
- Ledger's sync cloud is only needed for multi-device sync; derivation-only use is fully local (persist the stream tree client-side).
- Recovery from seed: YES ("one device tap to set up, then none").
- Caveats: requires the Ledger Sync app installed; the `wallet-cli`/LKRP libs are not on npm (source-vendor them or get them published); applicationId numbering is Ledger's call.
- Prize fit: ETHOnline "Continuity" ($1,500, "move its secrets onto the Key Ring") + "pick up an open issue and land a real fix" (no existing open issue for browser LKRP support — filing ours and landing it IS the contribution). Also fits AI Agents track's "Bring the Key Ring to hosts with no USB port".

## Path B — OpenPGP device app (simpler, weaker recovery)

From https://developers.ledger.com/docs/ai-tools/hardware-security/open-pgp:
the Ledger holds an OpenPGP keypair generated on-device; material encrypted to the
pubkey is unreadable without the device; optional strict mode requires a tap per
decryption (device becomes an approval gate).

Two ways to use it for slot keys:

1. **Signature-derived (deterministic within device lifetime):** have the device sign a
   fixed domain-separated message (`"soulvault-keyring-v1"` + wallet address) once →
   deterministic signature bytes → `ringSecret` via HKDF → same expansion as above.
   One interaction. Caveats: signatures must be deterministic (RSA-PKCS1 / Ed25519 are);
   signing prompts on the PGP app; performance of on-device RSA.
2. **Wrap-not-derive (lowest risk, fixes the real bug):** keep random slot keys, but wrap
   them to the Ledger's OpenPGP **public** key instead of storing raw in localStorage.
   Recovery = device present. No determinism needed; eliminates the "localStorage lost /
   run rotated" failure class without touching the KDF story. Can be layered on the
   current session model immediately.

Key caveat vs Path A: **OpenPGP keys are NOT seed-derived.** The docs warn keys do not
persist across app reinstalls/OS updates and require manual backup/restore
(`app-openpgp` repo). So recovery = backup file, not seed. "Deterministic from seed"
is only true for the LKRP path.

## Recommendation

- Demo (now): keep localStorage + run archival.
- Quick win: Path B-2 (OpenPGP-wrapped slot-key backup) — small, additive, good demo
  talking point ("keys never sit in plaintext").
- Full story: Path A (LKRP browser support) — file the issue on ledger-live, land the
  WebUSB/transport adapter, use SoulVault as consumer. This is the ETHOnline submission.

## References

- https://developers.ledger.com/ethonline (tracks, prizes, DX-feedback requirement)
- https://developers.ledger.com/docs/ai-tools/hardware-security/open-pgp (.md version exists for agents)
- `LedgerHQ/ledger-live` `docs/ledger-sync/01-hardware-lkrp.md` (LKRP protocol surface, APDU flow, applicationId table)
- Our KDF analysis and browser-feasibility findings are summarized in this ticket; deeper
  notes in the session log (LKRP `withDevice` injection, noble crypto, optional cloud).
