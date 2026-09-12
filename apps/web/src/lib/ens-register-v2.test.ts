import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import {
  decodeEnsV2RegistryRecord,
  encodeEnsV2RegistryRecord,
  encodeInitializeData,
  EAC_ALL_ROLES,
  expiryFromNow,
  orgRegistrySalt,
  ORG_NAME_ROLES,
  parseEnsV2OrgLabel,
} from "./ens-register-v2";

describe("parseEnsV2OrgLabel", () => {
  it("normalizes a root .eth name", () => {
    expect(parseEnsV2OrgLabel("SoulVault.ETH")).toEqual({
      normalized: "soulvault.eth",
      label: "soulvault",
    });
  });

  it("rejects subdomains", () => {
    expect(() => parseEnsV2OrgLabel("ops.soulvault.eth")).toThrow(/single label/);
  });

  it("rejects names that are not .eth", () => {
    expect(() => parseEnsV2OrgLabel("soulvault")).toThrow(/\.eth/);
  });
});

describe("expiryFromNow", () => {
  it("adds the epoch seconds to now", () => {
    const now = 1_700_000_000;
    expect(expiryFromNow(30 * 24 * 60 * 60, now)).toBe(BigInt(now + 30 * 24 * 60 * 60));
  });

  it("rejects non-positive epochs", () => {
    expect(() => expiryFromNow(0)).toThrow(/positive/);
    expect(() => expiryFromNow(-5)).toThrow(/positive/);
  });
});

describe("orgRegistrySalt", () => {
  it("is deterministic per label", () => {
    expect(orgRegistrySalt("soulvault")).toBe(orgRegistrySalt("soulvault"));
    expect(orgRegistrySalt("soulvault")).not.toBe(orgRegistrySalt("other"));
  });
});

describe("encodeInitializeData", () => {
  it("encodes initialize(rootAccount, ALL_ROLES) with the caller as root", () => {
    const owner = getAddress("0x0000000000000000000000000000000000000001");
    const data = encodeInitializeData(owner);
    // selector(8 hex chars) + 2 words (128 hex chars) = 136 hex chars payload
    expect(data).toMatch(/^0x[0-9a-f]{136}$/i);
    // rootAccount is the first arg — check it appears in the data word
    expect(data.slice(-64)).toBe(EAC_ALL_ROLES.toString(16).padStart(64, "0"));
    expect(data.toLowerCase()).toContain("0000000000000000000000000000000000000001");
  });
});

describe("org name roles", () => {
  it("grants set-resolver + renew (not registrar) to the name owner", () => {
    expect(ORG_NAME_ROLES).toBe((1n << 24n) | (1n << 16n));
    expect(ORG_NAME_ROLES & (1n << 0n)).toBe(0n);
  });

  it("ALL_ROLES has bit 0 in every nybble", () => {
    expect(EAC_ALL_ROLES.toString(16)).toBe("1".repeat(64));
  });
});

describe("ensv2Registry pointer record", () => {
  const registry = getAddress("0x1111111111111111111111111111111111111111");
  const owner = getAddress("0x2222222222222222222222222222222222222222");

  it("round-trips", () => {
    const value = encodeEnsV2RegistryRecord({ registry, owner });
    expect(decodeEnsV2RegistryRecord(value)).toEqual({ registry, owner });
  });

  it("round-trips with deployedAt", () => {
    const value = encodeEnsV2RegistryRecord({ registry, owner, deployedAt: "2026-09-11T00:00:00Z" });
    expect(decodeEnsV2RegistryRecord(value)).toEqual({
      registry,
      owner,
      deployedAt: "2026-09-11T00:00:00Z",
    });
  });

  it("returns null for v1 garbage (backwards-compat orgs)", () => {
    expect(decodeEnsV2RegistryRecord("not json")).toBeNull();
    expect(decodeEnsV2RegistryRecord(JSON.stringify({ registry, owner }))).toBeNull();
    expect(decodeEnsV2RegistryRecord(JSON.stringify({ version: 1, registry, owner }))).toBeNull();
  });
});
