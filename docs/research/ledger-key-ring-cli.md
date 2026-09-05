# Ledger Key Ring CLI: SoulVault fit

**Checked:** 2026-09-05
**Scope:** Ledger's ETHOnline page, current Wallet CLI documentation/source, and the
Ledger Key Ring Protocol (LKRP) technical paper. Only first-party Ledger sources
are used.

## Bottom line

`wallet-cli ring` is a local/headless encryption interface backed by the Ledger
Key Ring Protocol. A Ledger device is needed to enroll the machine and create or
recover its trustchain membership. Afterwards the enrolled machine can derive a
named, application-scoped key and encrypt/decrypt files or stdin using
AES-256-GCM without reconnecting the device; it still needs the Ledger
trustchain service and its local member credential.

It is applicable to SoulVault, but as an **additional key backend or owner
recovery layer**, not as a drop-in replacement for SoulVault's recipient grants:

- **Bundle creation: strong auxiliary fit.** Use a named ring key to protect an
  author's local draft, an owner recovery escrow containing slot keys, or other
  build/CI secrets. This cleanly demonstrates moving an existing secret backend
  onto Ledger.
- **Rehydration: conditional fit.** A CLI/headless consumer enrolled in the same
  Key Ring can decrypt a ring-protected artifact. The browser-first recipient
  flow should retain wallet-attested recipient keys and onchain grant/revoke
  filtering; the current CLI does not expose LKRP member sharing, per-slot
  grants, or a browser API.
- **Do not encrypt the sole canonical bundle with one ring key.** That would
  collapse SoulVault's per-slot/per-recipient authorization into one shared
  capability and weaken selective disclosure.

## What the CLI actually does

The Wallet CLI is Ledger's DMK-based, USB-facing personal-wallet CLI. Version
2.0 added `ring`; its commands are `init`, `encrypt`, `decrypt`, `keys`, and
`destroy`. Ledger's guide says `init` is a one-time, device-required operation,
while encryption and decryption afterwards require network access to restore the
trustchain but no device. Inputs may be files or stdin/stdout, and encryption is
AES-256-GCM under a user-supplied key name.

Sources:

- [Ledger Wallet CLI guide](https://developers.ledger.com/docs/ai-tools/ledger-cli#key-ring)
- [Wallet CLI README in Ledger Wallet source](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/wallet-cli/README.md)
- [`ring init` implementation](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/wallet-cli/src/commands/ring/init.ts)
- [named-domain key derivation and AES-GCM wire format](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/wallet-cli/src/key-ring/crypto.ts)

The key name is not an independent stored key. The implementation restores
`walletSyncEncryptionKey`, derives 256 bits with HKDF-SHA-256 using a fixed
`wallet-cli-domain-v1` salt and the name as `info`, and uses that result as the
AES-GCM key. The ciphertext format is a 12-byte IV followed by the authenticated
ciphertext. Thus `--key soulvault-owner-recovery-v1` provides cryptographic
domain separation, but the CLI's current surface is whole-blob encryption—not
SoulVault's per-recipient wrapping protocol.

## Trust and security model

There are three distinct trust anchors:

1. **Ledger device at enrollment/recovery.** `ring init` creates a machine member
   credential, asks the Ledger Sync app to create or recover the trustchain, and
   enrolls the machine. LKRP's paper describes the secure device as the authority
   that approves encryption-key access on its trusted display. It explicitly
   says LKRP uses randomly generated encryption keys and never reveals private
   keys derived from the 24-word recovery phrase.
2. **Local machine member credential after enrollment.** The CLI stores a member
   private key in the OS keychain. By default it is additionally wrapped with a
   password-derived AES key (PBKDF2-HMAC-SHA-256, 600,000 iterations). Therefore
   routine `ring encrypt`/`decrypt` is not a fresh hardware approval: compromise
   of the unlocked host plus its credential/password path can expose the derived
   ring key.
3. **Ledger trustchain service availability/integrity.** Routine operations
   restore the trustchain over the configured Ledger API. LKRP command streams
   are hash-linked and issuer-signed, allowing clients/devices to verify their
   integrity, while encrypted keys are published only to listed members.

Sources:

- [LKRP technical white paper](https://github.com/LedgerHQ/ledger-key-ring-protocol-whitepaper/blob/main/Ledger%20Key%20Ring%20Protocol%20Technical%20White%20Paper.pdf)
- [local credential storage](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/wallet-cli/src/key-ring/keychain.ts)
- [trustchain restore and rotation handling](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/wallet-cli/src/key-ring/load-key-ring.ts)
- [Ledger API configuration](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/wallet-cli/src/key-ring/lkrp-sdk.ts)

The ETHOnline page summarizes this as keys “derived from your Ledger seed” and
recoverability from the seed. The protocol paper is more precise: data-encryption
keys are random and backed by the LKRP object; the device's seed-derived identity
controls recovery/access without exporting a seed-derived private key. We should
use that precise wording in SoulVault documentation.

Removal is forward-looking, not retroactive. LKRP's paper says a recipient that
already learned a key cannot be made to forget it; revocation requires rotation
and re-encryption of the affected subtree/data. The Wallet CLI likewise warns
that a trustchain rotation can make older ciphertext undecryptable from the new
application path. This matches SoulVault's existing caveat that already revealed
plaintext cannot be revoked.

## Flow mapping to SoulVault

### Bundle creation

Recommended experiment:

1. The author's browser continues generating independent `K_i` values and
   producing AAD-bound slot ciphertexts.
2. The CLI serializes an **owner recovery escrow** containing the document ID,
   version, and `slotId -> K_i` mapping.
3. Pipe that escrow through `wallet-cli ring encrypt --key
   soulvault-owner-recovery-v1` and store the ciphertext alongside the bundle or
   on 0G.
4. Keep recipient-specific `SlotKeyGranted` wrapping unchanged.

This provides seed-recoverable owner continuity without granting every recipient
every slot. An alternative lower-value integration is protecting local author
drafts or `.env` credentials used during bundle publication.

Using the ring key directly as every `K_i`, or encrypting the only hydration
bundle with one ring key, is not recommended. Possession of one application key
would unlock all slots, and recipients outside the author's Key Ring could not
use SoulVault's normal grant mechanism.

### Rehydration

For an enrolled CLI/agent runtime, `ring decrypt` can recover the owner escrow or
a separately ring-protected artifact. This is useful for disaster recovery and
headless continuity. It is not equivalent to the planned browser hydration flow:

- no current browser-facing Key Ring interface is documented;
- the Wallet CLI requires a local OS-keychain credential, password, and network
  trustchain restore;
- the CLI exposes no command to add/share with a recipient member;
- routine decrypt has no Ledger tap, so it is not fresh wallet authorization;
- SoulVault still needs to evaluate current onchain grants/revocations before
  releasing or using a slot key.

If deeper LKRP integration is desired later, the protocol itself supports
hierarchical keys, member publication, scoped sharing, and rotation—conceptually
an excellent match for documents and slots. That work would use Ledger's LKRP
SDK/protocol surface, not merely today's five `wallet-cli ring` commands, and
would need an explicit mapping between LKRP paths, SoulVault documents/slots,
and contract events.

## ETHOnline relevance

Ledger's ETHOnline page explicitly names `wallet-cli ring` in both tracks. For
AI Agents × Ledger, it asks for agents using non-leakable scoped capabilities or
bringing Key Ring enrollment to USB-less hosts. For Continuity, it suggests
moving an existing project's `.env`, `sops`, or `age` key backend to the ring.
The page describes “Beyond crypto” as its Key Ring CLI pillar.

Source: [Ledger ETHOnline 2026](https://developers.ledger.com/ethonline)

For the hackathon narrative, the defensible before/after is:

> Before: the bundle author must retain raw owner recovery material in local
> files or lose recovery. After: SoulVault can store only a ring-encrypted owner
> escrow, recoverable by re-enrolling with the Ledger while preserving the
> existing per-slot recipient-grant model.

This is sponsor-legible and additive. It should be presented separately from the
DMK signer and Speculos-browser test harness, and never imply that Key Ring alone
implements SoulVault's onchain authorization or revocation semantics.
