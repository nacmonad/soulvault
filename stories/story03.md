# Story 03 — Rotate a swarm epoch bundle and verify the member entry

This story demonstrates the MVP epoch bundle flow.

Goal:
- rotate the active swarm to a new epoch
- generate the plaintext wrapped-key JSON bundle
- upload that bundle to 0G
- update the swarm contract to point at the new bundle
- fetch the bundle back from 0G
- verify that the current member can decrypt its own wrapped entry

This story is important because it proves the core `K_epoch` publication loop without requiring the full post-MVP historical recovery design.

---

## 1) Rotate the swarm epoch
```bash
soulvault epoch rotate --swarm ops
```

Behavior:
- reads the active members for the swarm
- computes the next epoch
- generates a structured plaintext JSON bundle
- wraps the current epoch key once per active member pubkey
- uploads the bundle JSON to 0G
- calls `rotateEpoch(...)` on the swarm contract with `keyBundleRef` and `keyBundleHash`

---

## 2) Fetch and inspect the latest bundle
```bash
soulvault epoch show-bundle --swarm ops
```

Shows:
- swarm contract
- epoch
- membership version
- 0G bundle reference/hash
- per-member wrapped entry metadata

---

## 3) Verify the current member can decrypt its own entry
```bash
soulvault epoch decrypt-bundle-member --swarm ops
```

Default behavior:
- fetches the latest bundle from 0G
- finds the current member's entry by wallet address
- decrypts the wrapped key using the local signer private key
- verifies that it matches the expected local epoch key material
- prints only verification/fingerprint information by default

Unsafe/dev mode:
```bash
soulvault epoch decrypt-bundle-member --swarm ops --print-key
```

This may print the raw epoch key for debugging. Avoid that in normal/production contexts.

---

## Notes
- MVP currently treats the uploaded bundle JSON as the canonical artifact to inspect and verify.
- Owner escrow and historical epoch recovery remain explicitly deferred until after MVP.
- The current member-key wrapping path uses `secp256k1-ecdh-aes-256-gcm` because the swarm stores secp256k1 public keys today.
