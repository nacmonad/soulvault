import { describe, expect, it } from "vitest";

import { asHex, ledgerSignature, yParityFromV } from "./wallet-tx";

describe("ledger signature helpers", () => {
  it("maps Ledger v values onto yParity", () => {
    expect(yParityFromV(0)).toBe(0);
    expect(yParityFromV(27)).toBe(0);
    expect(yParityFromV(1)).toBe(1);
    expect(yParityFromV(28)).toBe(1);
    expect(yParityFromV(37)).toBe(0);
    expect(yParityFromV(38)).toBe(1);
  });

  it("normalizes r/s without requiring a 0x prefix", () => {
    const sig = ledgerSignature({
      r: "11".repeat(32),
      s: "22".repeat(32),
      v: 28,
    });
    expect(sig.r).toBe(asHex("11".repeat(32)));
    expect(sig.s).toBe(asHex("22".repeat(32)));
    expect(sig.yParity).toBe(1);
  });
});
