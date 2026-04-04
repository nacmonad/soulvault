# SoulVault Cryptographic Model

## Core Principles

- No plaintext leaves the local machine (neither onchain nor in remote storage)
- No symmetric keys are stored onchain — only references and hashes
- Membership controls future access (via epoch rotation on membership change)
- Shared epoch key (K_epoch) enables coordination — all active members can read each other's state

---

## K_epoch Lifecycle

### 1. Generation
Owner generates a new 256-bit (32-byte) random epoch key when membership changes.

### 2. Wrapping (Per-Member)
For each active member, the epoch key is wrapped using:
- **Algorithm:** `secp256k1-ecdh-aes-256-gcm`
- **Flow:**
  1. Generate ephemeral secp256k1 keypair
  2. Compute shared secret: `ECDH(ephemeral_private, member_secp256k1_pubkey)`
  3. Derive AES key: `SHA256(shared_secret)`
  4. Encrypt K_epoch with AES-256-GCM using random 12-byte nonce
  5. Output: `base64(ciphertext || authTag)` + ephemeral public key + nonce

Every bundle also includes an **owner escrow entry** — required for historical key recovery.

### 3. Upload
The complete epoch bundle (JSON) is uploaded to 0G Storage. Only the `keyBundleRef` (0G root hash) and `keyBundleHash` (keccak256 of JSON bytes) are stored onchain.

### 4. Onchain Rotation
`rotateEpoch(newEpoch, keyBundleRef, keyBundleHash, expectedMembershipVersion)` is called on the swarm contract. Reverts if `membershipVersion` changed since bundle generation (concurrency guard against membership changes during rotation).

### 5. Member Unwrapping
Each member:
1. Fetches bundle from 0G via `keyBundleRef` from `EpochRotated` event
2. Finds their entry by wallet address
3. Computes: `ECDH(member_private, ephemeral_public)` → shared secret
4. Derives AES key: `SHA256(shared_secret)`
5. Decrypts wrapped key with AES-256-GCM
6. Stores unwrapped K_epoch locally in `~/.soulvault/keys/<swarm>/epoch-<n>.json`

### 6. Historical Key Access
For new joiners or recovered nodes:
1. Owner re-wraps historical K_epoch values from their escrow entries
2. Publishes historical key bundle to 0G
3. Calls `grantHistoricalKeys(member, bundleRef, bundleHash, fromEpoch, toEpoch)`
4. Member unwraps each historical epoch key and stores locally

---

## Backup Encryption

### Algorithm
- **Cipher:** AES-256-GCM
- **Key:** K_epoch (current epoch key from local store)
- **Nonce:** Random 12 bytes (hex-encoded in manifest)
- **AAD:** JSON string of archive metadata (utf8-encoded)
- **Auth tag:** 16 bytes (hex-encoded in manifest)

### Backup Flow
1. Archive workspace → `tar.gz`
2. Compute SHA256 of archive
3. Encrypt entire archive with K_epoch (AES-256-GCM)
4. Compute SHA256 of ciphertext
5. Upload ciphertext to 0G Storage → get `rootHash`
6. Publish file mapping onchain: `storageLocator` (0G root hash), `merkleRoot` (SHA256 of ciphertext as bytes32), `publishTxHash`, `manifestHash` (SHA256 of manifest JSON as bytes32), `epoch`
7. Save manifest locally to `~/.soulvault/last-backup.json`

### Manifest Fields
```json
{
  "nonce": "<hex>",
  "aad": "<string>",
  "authTag": "<hex>",
  "ciphertextSha256": "<hex>"
}
```

### Restore Flow
1. Read manifest from `last-backup.json` or from command flags
2. Fetch encrypted backup from 0G via `rootHash`
3. Unwrap K_epoch from epoch bundle (if not already stored locally)
4. Decrypt with AES-256-GCM using nonce, aad, authTag from manifest
5. Extract tar.gz to target directory
6. Verify SHA256 hashes per file

---

## Epoch Bundle JSON Format

```json
{
  "version": 1,
  "swarm": {
    "contract": "0x...",
    "chainId": 16602,
    "epoch": 2,
    "membershipVersion": 3
  },
  "keyWrap": {
    "algorithm": "secp256k1-ecdh-aes-256-gcm",
    "note": "wrapped K_epoch entries per active member"
  },
  "entries": {
    "0xMemberAddress": {
      "wrappedKey": "<base64(ciphertext || authTag)>",
      "pubkeyRef": "agent-pubkey:0x...",
      "algorithm": "secp256k1-ecdh-aes-256-gcm",
      "ephemeralPublicKey": "<hex, uncompressed>",
      "nonce": "<hex, 12 bytes>"
    }
  },
  "createdAt": "2026-04-04T..."
}
```

---

## Agent URI Format (ERC-8004)

Agent identity metadata is stored as a base64-encoded JSON data URI in the ERC-8004 registry on Sepolia.

```json
{
  "type": "SoulVaultAgent",
  "name": "RustyBot",
  "description": "...",
  "image": "...",
  "services": [
    { "type": "api", "url": "https://..." },
    { "type": "a2a", "url": "https://..." }
  ],
  "supportedTrust": ["erc8004", "soulvault"],
  "soulvault": {
    "swarmContract": "0x...",
    "memberAddress": "0x...",
    "role": "member-agent",
    "harness": "openclaw",
    "backupHarnessCommand": "...",
    "registryAddress": "0x..."
  }
}
```

---

## Security Boundaries

| Boundary | Protection |
|----------|-----------|
| Epoch key at rest | Stored locally in `~/.soulvault/keys/`, never transmitted in plaintext |
| Backup at rest (0G) | AES-256-GCM encrypted, key not stored alongside ciphertext |
| Epoch bundle at rest (0G) | Each entry individually wrapped per member pubkey |
| Onchain references | Only hashes and storage locators — no keys, no plaintext |
| Membership revocation | Rotating K_epoch after `removeMember` ensures removed member cannot decrypt future data |
| Concurrency | `membershipVersion` guard prevents stale bundles from being rotated in |
