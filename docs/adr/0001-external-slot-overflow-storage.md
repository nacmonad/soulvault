# ADR: Integrity-bound overflow storage for document bundles

Status: accepted (2026-09-07)
Ticket: nacmonad/soulvault#10 · Parent spec: #5

## Context

The document travels as a JSON bundle file (`PublicDocumentBundle`); the registry
anchors its integrity (`docHash`, author, `slotIds`) and carries only grant
events — ciphertexts never ride events (spec §3–§4, #9). Slot ciphertexts are
small PII fields, but nothing in the bundle format bounded payload size. Large
payloads need an escape hatch that (a) never inspects secret plaintext, (b) can
be fulfilled by the existing 0G Storage client in `packages/node`, and (c) does
not make any network SDK a dependency of `@soulvault/protocol`.

## Decision

### Payload representation (protocol package)

`EncryptedDocumentSlot` becomes a tagged union on `storage: 'inline' | 'located'`:

- **inline** (default, unchanged wire shape) — `ciphertext` (base64) rides in
  the bundle file as before.
- **located** — the bundle carries only an `ExternalSlotLocator`:
  `{ kind: 'external', protocolVersion, locator (URI), contentHash (sha256 hex
  of the exact stored bytes), byteLength }`. No ciphertext field is present.

The split is deterministic and depends only on already-public data:

```ts
shouldUseExternalStorage({ byteLength, thresholdBytes }) // default 64 KiB
```

with the contract: exactly one of `ciphertext` or an external locator is
selected by `sealedByteLength > thresholdBytes`. Callers may override the
default threshold, but policy never branches on plaintext content.

### Resolver abstraction (protocol package)

A single minimal port, implemented with `Uint8Array` only (isomorphic, no
fetch, no Node built-ins):

```ts
export interface ExternalSlotStore {
  get(locator: string): Promise<Uint8Array>;
  put(locator: string, bytes: Uint8Array): Promise<void>;
}
```

`resolveExternalSlots` turns a `PublicDocumentBundle` whose located slots still
reference an external store into one carrying inline payloads, verifying every
external record **before** hydration can see it:

- missing / empty record → `MISSING_SLOT`
- truncated (byteLength mismatch), invalid stored envelope, wrong version →
  `INVALID_ARTIFACT`
- content-hash mismatch → `AUTHENTICATION_FAILED`

Errors are typed (`DocumentProtocolError`), and verification failure happens
before slot decryption, so tampering or substitution fails closed.

**Stored envelope:** the bytes stored at a locator are themselves versioned
(`version`, `slotId`, `algorithm`, `nonce`, `tag`, `ciphertext`) so corruption
is distinguishable from substitution, and the `contentHash` + `byteLength` in
the bundle bind the exact stored bytes.

### Graceful degradation to `MISSING_SLOT`

`rehydrateDocument` (and therefore `rehydrateGrantedDocument`) keeps its
synchronous signature. Located slots that have not been resolved behave exactly
like unavailable slots: `MISSING_SLOT`, or marker-preserving partial hydration
under `allowPartial: true`. Fully resolving a bundle first yields byte-for-byte
identical hydration behavior to the inline path.

### In-memory adapter + 0G integration path

- `MemoryExternalSlotStore` (protocol) proves the abstraction without network
  credentials.
- `packages/node/src/external-slot-0g.ts` adapts the existing 0G client
  (`uploadBufferTo0G` / `downloadFrom0G`) to the same interface — at integration
  time the 0G root hash *is* the locator string. `@soulvault/protocol` carries
  no 0G, ethers, or Node dependency; the adapter lives in the node package that
  already depends on the 0G SDK.

## Consequences

- Bundle format, grant events, and hydration semantics are unchanged for every
  existing inline producer and consumer; the `storage` discriminator defaults
  to inline so old bundles parse as before.
- Oversized slots get durable, integrity-bound storage without widening the
  protocol package's trust base or dependency tree.
- `resolveExternalSlots` is the single async seam; everything downstream of it
  stays synchronous and deterministic.
