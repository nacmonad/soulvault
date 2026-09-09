import { describe, expect, it } from "vitest";

import {
  coinTypeForChain,
  encodeStringArrayCbor,
  encodeSwarmsListDataUri,
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
