import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

/**
 * Adoption-probe coverage (ticket 016): findExistingSwarmDeployment must adopt
 * an existing swarm only when the ENS records point at a live SoulVaultSwarm
 * (treasury() answers), and report treasuryMatches so runSwarmCreate can
 * hard-stop on a mismatch instead of deploying a duplicate.
 */

type ReadArgs = {
  address: Address;
  functionName: string;
  args: readonly unknown[];
};

type ReadRouter = (args: ReadArgs) => Promise<unknown>;

let readRouter: ReadRouter = async () => null;

vi.mock("@/lib/onchain/client", () => ({
  getBrowserSoulVaultClientConfig: vi.fn(() => ({
    rpcUrl: "https://example-rpc.test",
    chainId: 11155111,
    deployments: [],
  })),
  createSoulVaultPublicClient: vi.fn(() => ({
    readContract: (args: ReadArgs) => readRouter(args),
  })),
}));

vi.mock("@/lib/ens-writes", () => ({
  namehash: (name: string) => ("0x" + name) as Hex,
  RESOLVER_ABI: [],
  resolveOrgResolver: vi.fn(async () => "0x9999999999999999999999999999999999999999"),
  getAddrMultichain: vi.fn(),
  setAddrMultichain: vi.fn(),
  addSwarmToOrgList: vi.fn(),
  bindSwarmEnsSubdomain: vi.fn(),
  upsertOrgTreasury: vi.fn(),
  upsertDocumentRegistryEnsRecord: vi.fn(),
}));

vi.mock("@/lib/wallet-tx", () => ({
  sendWalletTransaction: vi.fn(),
  deployWalletContract: vi.fn(),
  waitForWalletReceipt: vi.fn(),
}));

vi.mock("@/lib/document-registry", () => ({
  asDocHash: vi.fn(),
  WRITE_ABI: [],
  resolveDocumentRegistryAddress: vi.fn(),
}));

import { findExistingSwarmDeployment } from "./create-flows";

const FROM = "0x1111111111111111111111111111111111111111" as const;
const ORG = "soulvault-ensv2.eth";
const SWARM = "ops.soulvault-ensv2.eth";
const EXISTING_SWARM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const EXPECTED_TREASURY = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const OTHER_TREASURY = "0xcccccccccccccccccccccccccccccccccccccccc" as const;

const NODE = ("0x" + SWARM) as Hex; // the namehash mock is a passthrough: "0x" + name

function routeSwarm({ treasury }: { treasury: Address | Error }): ReadRouter {
  return async ({ functionName, args }) => {
    if (functionName === "addr" && args[0] === NODE) return EXISTING_SWARM;
    if (functionName === "text" && args[0] === NODE && args[1] === "soulvault.swarmContract") return EXISTING_SWARM;
    if (functionName === "treasury") {
      if (treasury instanceof Error) throw treasury;
      return treasury;
    }
    return null;
  };
}

beforeEach(() => {
  readRouter = async () => null;
});

describe("findExistingSwarmDeployment", () => {
  it("adopts a live swarm whose treasury matches and reports treasuryMatches: true", async () => {
    readRouter = routeSwarm({ treasury: EXPECTED_TREASURY });
    const result = await findExistingSwarmDeployment({
      from: FROM,
      organizationEnsName: ORG,
      swarmEnsName: SWARM,
      expectedTreasury: EXPECTED_TREASURY,
    });
    expect(result).toEqual({
      // getAddress checksums — the probe normalizes via getAddress before use.
      swarmAddress: getAddress(EXISTING_SWARM),
      treasury: EXPECTED_TREASURY,
      treasuryMatches: true,
    });
  });

  it("flags a treasury mismatch so the caller hard-stops instead of re-deploying", async () => {
    readRouter = routeSwarm({ treasury: OTHER_TREASURY });
    const result = await findExistingSwarmDeployment({
      from: FROM,
      organizationEnsName: ORG,
      swarmEnsName: SWARM,
      expectedTreasury: EXPECTED_TREASURY,
    });
    expect(result?.treasuryMatches).toBe(false);
    expect(result?.swarmAddress.toLowerCase()).toBe(EXISTING_SWARM);
  });

  it("returns null when the records are empty (fresh name)", async () => {
    const result = await findExistingSwarmDeployment({
      from: FROM,
      organizationEnsName: ORG,
      swarmEnsName: SWARM,
      expectedTreasury: EXPECTED_TREASURY,
    });
    expect(result).toBeNull();
  });

  it("ignores candidates that are not SoulVaultSwarm contracts (treasury() reverts)", async () => {
    readRouter = routeSwarm({ treasury: new Error("execution reverted") });
    const result = await findExistingSwarmDeployment({
      from: FROM,
      organizationEnsName: ORG,
      swarmEnsName: SWARM,
      expectedTreasury: EXPECTED_TREASURY,
    });
    expect(result).toBeNull();
  });

  it("works when only the text record is set (deploy landed, addr write did not)", async () => {
    readRouter = async ({ functionName, args }) => {
      if (functionName === "addr") throw new Error("no record");
      if (functionName === "text" && args[0] === NODE && args[1] === "soulvault.swarmContract") return EXISTING_SWARM;
      if (functionName === "treasury") return OTHER_TREASURY;
      return null;
    };
    const result = await findExistingSwarmDeployment({
      from: FROM,
      organizationEnsName: ORG,
      swarmEnsName: SWARM,
      expectedTreasury: EXPECTED_TREASURY,
    });
    expect(result?.swarmAddress.toLowerCase()).toBe(EXISTING_SWARM);
    expect(result?.treasuryMatches).toBe(false);
  });
});
