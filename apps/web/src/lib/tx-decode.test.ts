import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseEther, zeroAddress, type Address, type Hex } from "viem";

import { describeTransaction } from "./tx-decode";
import { RESOLVER_ABI } from "./ens-writes";
import { TREASURY_ABI } from "./treasury-contract";

const NODE = ("0x" + "ab".repeat(32)) as Hex;

describe("describeTransaction", () => {
  it("renders contract creation with initcode size", () => {
    const summary = describeTransaction({ to: null, data: ("0x" + "60".repeat(4000)) as Hex });
    expect(summary.title).toBe("Deploy contract");
    expect(summary.lines[0]).toContain("4000 bytes");
  });

  it("decodes the 3-arg ENSIP-11 setAddr with a friendly chain label", () => {
    const coinType = 2158638759; // 0x80000000 | 11155111
    const treasury = "0x9999999999999999999999999999999999999999" as Address;
    const data = encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setAddr",
      args: [NODE, BigInt(coinType), ("0x" + "00".repeat(12) + treasury.slice(2)) as Hex],
    });
    const summary = describeTransaction({ to: "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as Address, data });
    expect(summary.title).toBe("Set ENS address");
    expect(summary.lines.some((l) => l.includes("sepolia (11155111)") && l.includes(treasury))).toBe(true);
  });

  it("decodes setText with key/value", () => {
    const data = encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [NODE, "soulvault.swarms", "data:application/cbor;base64,omg"],
    });
    const summary = describeTransaction({ to: zeroAddress, data });
    expect(summary.title).toBe("Set ENS text record");
    expect(summary.lines[0]).toBe('text["soulvault.swarms"] = data:application/cbor;base64,omg');
  });

  it("decodes treasury withdraw with ETH amount and surfaces tx value", () => {
    const data = encodeFunctionData({
      abi: TREASURY_ABI,
      functionName: "withdraw",
      args: [zeroAddress, parseEther("1.5")],
    });
    const summary = describeTransaction({ to: zeroAddress, data });
    expect(summary.title).toBe("Treasury withdraw");
    expect(summary.lines.some((l) => l.includes("1.5 ETH"))).toBe(true);
  });

  it("surfaces tx value on payable calls", () => {
    const data = encodeFunctionData({ abi: TREASURY_ABI, functionName: "deposit" });
    const summary = describeTransaction({ to: zeroAddress, data, value: parseEther("2") });
    expect(summary.title).toBe("Deposit to treasury");
    expect(summary.lines.some((l) => l === "Value: 2 ETH")).toBe(true);
  });

  it("falls back to a selector summary for unknown calldata — never throws", () => {
    const summary = describeTransaction({
      to: zeroAddress,
      data: ("0xdeadbeef" + "ab".repeat(16)) as Hex,
    });
    expect(summary.title).toBe("Contract call (0xdeadbeef)");
    expect(summary.lines.some((l) => l.startsWith("Selector: 0xdeadbeef"))).toBe(true);
  });
});
