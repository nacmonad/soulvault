import { describe, expect, it } from "vitest";

import {
  coinTypeForChain,
  encodeStringArrayCbor,
  encodeSwarmsListDataUri,
  ensV2OrgRoot,
  normalizeEnsV2LabelState,
} from "./ens-writes";

// The CLI-side reference implementation lives in packages/node/src/ens.ts. Its
// writeOrgSwarmsList sorts + dedupes before encoding, wraps in a
// data:application/cbor;base64 URI, and node readers decode with
// decodeStringArrayCbor. These fixtures pin the byte-level contract so a
// browser-side drift cannot silently break CLI readers (ticket 009).
describe("ens-writes CBOR parity with packages/node/src/ens.ts", () => {
  it("encodes an empty list as CBOR array length 0", () => {
    expect(encodeStringArrayCbor([])).toEqual(new Uint8Array([0x80]));
  });

  it("encodes a single label with inline length", () => {
    // ["ops"] → 0x81 (array len 1), 0x63 (text len 3), 'ops'
    expect(encodeStringArrayCbor(["ops"])).toEqual(new Uint8Array([0x81, 0x63, 0x6f, 0x70, 0x73]));
  });

  it("encodes multi-byte lengths per RFC 8949 §3", () => {
    const long = "x".repeat(300); // needs the 2-byte extended length form
    const bytes = encodeStringArrayCbor([long]);
    expect(bytes[0]).toBe(0x81); // array, 1 item
    expect(bytes[1]).toBe(0x79); // text, additional info 25 (2 following bytes)
    expect(bytes[2]).toBe(1); // 300 = 0x012C → high byte
    expect(bytes[3]).toBe(0x2c); // low byte
    expect(bytes.length).toBe(4 + 300);
  });

  it("wraps the list in the data URI exactly like the CLI writer", () => {
    // Cross-checked against packages/node encodeStringArrayCbor(['ops']) → gWNvcHM=
    expect(encodeSwarmsListDataUri(["ops"])).toBe("data:application/cbor;base64,gWNvcHM=");
  });

  it("sorts and dedupes like writeOrgSwarmsList", () => {
    expect(encodeSwarmsListDataUri(["b", "a", "b", "c"])).toBe(encodeSwarmsListDataUri(["c", "a", "b"]));
  });

  it("derives the Sepolia coinType (0x80000000 | 11155111)", () => {
    // Cross-checked: 0x80000000 | 11155111 === 2158638759
    expect(coinTypeForChain(11155111)).toBe(2158638759);
    // Historical 0G Galileo. (The old glossary said 2147500186 — off by 64, a doc typo.)
    expect(coinTypeForChain(16602)).toBe(2147500250);
  });
});

// Regression: this viem version decodes named tuple outputs to OBJECTS (see
// ens-register-v2.ts readLabelState). readEnsV2OrgContext used to numeric-index
// the getState result, so the v2 fallback ownership check always failed and
// treasury/swarm creation for v2 orgs died with "does not own (owner 0x000…0)"
// — even for the actual owner, when the pointer record wasn't readable yet.
describe("normalizeEnsV2LabelState", () => {
  const owner = "0x56C528C96D19bd88844fb608035f4c745f25287b" as const;

  it("reads the object shape this viem version produces", () => {
    expect(
      normalizeEnsV2LabelState({ status: 2, expiry: 123n, latestOwner: owner, tokenId: 7n, resource: 8n }),
    ).toEqual({ status: 2, expiry: 123n, latestOwner: owner });
  });

  it("reads the array shape defensive callers may still see", () => {
    expect(normalizeEnsV2LabelState([2, 123n, owner, 7n, 8n])).toEqual({
      status: 2,
      expiry: 123n,
      latestOwner: owner,
    });
  });

  it("returns null for empty/undefined/malformed decodes", () => {
    expect(normalizeEnsV2LabelState(null)).toBeNull();
    expect(normalizeEnsV2LabelState(undefined)).toBeNull();
    expect(normalizeEnsV2LabelState({})).toBeNull();
  });
});

// Regression: readEnsV2OrgContext passed the name straight to
// parseEnsV2OrgLabel, which throws on multi-label names — so every resolver
// read for a swarm SUBDOMAIN (ops.<org>.eth) failed and the swarm was
// silently excluded from event discovery while the treasury (read via the
// org name) stayed visible. Subdomains resolve through the org root.
describe("ensV2OrgRoot", () => {
  it("reduces a swarm subdomain to its org root", () => {
    expect(ensV2OrgRoot("ops.soulvault-ensv2.eth")).toBe("soulvault-ensv2.eth");
    expect(ensV2OrgRoot("primary.myorg.eth")).toBe("myorg.eth");
  });

  it("leaves an org root unchanged", () => {
    expect(ensV2OrgRoot("soulvault-ensv2.eth")).toBe("soulvault-ensv2.eth");
  });

  it("normalizes case before reducing", () => {
    expect(ensV2OrgRoot("OPS.SoulVault-Ensv2.eth")).toBe("soulvault-ensv2.eth");
  });
});
