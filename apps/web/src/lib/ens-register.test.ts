import { describe, expect, it } from "vitest";

import { parseEthRootLabel, registrationPaymentWei, registrationValueWei } from "./ens-register";

describe("parseEthRootLabel", () => {
  it("normalizes a root .eth name", () => {
    expect(parseEthRootLabel("OttoXOrg.ETH")).toEqual({
      normalized: "ottoxorg.eth",
      label: "ottoxorg",
    });
  });

  it("rejects subdomains", () => {
    expect(() => parseEthRootLabel("ops.ottoxorg.eth")).toThrow(/root \.eth/);
  });

  it("rejects names that are not .eth", () => {
    expect(() => parseEthRootLabel("ottoxorg")).toThrow(/root \.eth/);
  });
});

describe("registrationValueWei", () => {
  it("adds the 110% buffer used by the CLI", () => {
    expect(registrationValueWei(1000n, 0n)).toBe(1100n);
    expect(registrationValueWei(100n, 50n)).toBe(165n);
  });
});

describe("registrationPaymentWei", () => {
  it("pays exact base+premium so the controller does not refund", () => {
    expect(registrationPaymentWei(1000n, 0n)).toBe(1000n);
    expect(registrationPaymentWei(100n, 50n)).toBe(150n);
  });
});
