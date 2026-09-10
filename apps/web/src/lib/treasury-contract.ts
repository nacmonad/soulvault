import { encodeFunctionData, parseUnits, type Address, type Hex } from "viem";

import { sendWalletTransaction } from "@/lib/wallet-tx";

/**
 * Treasury + swarm write surface for the story08 fund-request lifecycle
 * (docs: stories/story08.md). Mutual consent is enforced by the contracts:
 * the treasury checks `swarm.treasury() == address(this)` before any payout.
 * A delivered payout is final — the UI never offers revoke/un-send.
 */
export const TREASURY_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "approveFundRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "swarm", type: "address" },
      { name: "requestId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rejectFundRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "swarm", type: "address" },
      { name: "requestId", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const SWARM_ABI = [
  {
    type: "function",
    name: "requestFunds",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelFundRequest",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
  },
] as const;

/**
 * Resolve the treasury to target: callers pass the address resolved from the
 * org's ENS `soulvault.treasuries` record (see useOrgDiscovery).
 */
function resolveTreasury(explicit?: Address): Address {
  if (!explicit) {
    throw new Error("No treasury target — create one on the Treasury page (published on the org ENS soulvault.treasuries record).");
  }
  return explicit;
}

function resolveSwarm(explicit?: Address): Address {
  if (!explicit) {
    throw new Error("No swarm target — create one on the Swarm page (published on the org ENS soulvault.swarms record).");
  }
  return explicit;
}

export function parseEthAmount(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed || Number.isNaN(Number(trimmed))) {
    throw new Error("Amount must be a number in ETH.");
  }
  return parseUnits(trimmed, 18);
}

export async function depositToTreasury(input: {
  from: Address;
  amountWei: bigint;
  treasury?: Address;
}): Promise<Hex> {
  const treasury = resolveTreasury(input.treasury);
  return sendWalletTransaction({
    from: input.from,
    to: treasury,
    data: encodeFunctionData({ abi: TREASURY_ABI, functionName: "deposit" }),
    value: input.amountWei,
  });
}

export async function withdrawFromTreasury(input: {
  from: Address;
  to: Address;
  amountWei: bigint;
  treasury?: Address;
}): Promise<Hex> {
  const treasury = resolveTreasury(input.treasury);
  return sendWalletTransaction({
    from: input.from,
    to: treasury,
    data: encodeFunctionData({
      abi: TREASURY_ABI,
      functionName: "withdraw",
      args: [input.to, input.amountWei],
    }),
  });
}

export async function approveFundRequest(input: {
  from: Address;
  swarm: Address;
  requestId: bigint;
  treasury?: Address;
}): Promise<Hex> {
  const treasury = resolveTreasury(input.treasury);
  return sendWalletTransaction({
    from: input.from,
    to: treasury,
    data: encodeFunctionData({
      abi: TREASURY_ABI,
      functionName: "approveFundRequest",
      args: [input.swarm, input.requestId],
    }),
  });
}

export async function rejectFundRequest(input: {
  from: Address;
  swarm: Address;
  requestId: bigint;
  reason: string;
  treasury?: Address;
}): Promise<Hex> {
  const treasury = resolveTreasury(input.treasury);
  return sendWalletTransaction({
    from: input.from,
    to: treasury,
    data: encodeFunctionData({
      abi: TREASURY_ABI,
      functionName: "rejectFundRequest",
      args: [input.swarm, input.requestId, input.reason],
    }),
  });
}

export async function requestFunds(input: {
  from: Address;
  amountWei: bigint;
  reason: string;
  swarm?: Address;
}): Promise<Hex> {
  const swarm = resolveSwarm(input.swarm);
  return sendWalletTransaction({
    from: input.from,
    to: swarm,
    data: encodeFunctionData({
      abi: SWARM_ABI,
      functionName: "requestFunds",
      args: [input.amountWei, input.reason],
    }),
  });
}

export async function cancelFundRequest(input: {
  from: Address;
  requestId: bigint;
  swarm?: Address;
}): Promise<Hex> {
  const swarm = resolveSwarm(input.swarm);
  return sendWalletTransaction({
    from: input.from,
    to: swarm,
    data: encodeFunctionData({
      abi: SWARM_ABI,
      functionName: "cancelFundRequest",
      args: [input.requestId],
    }),
  });
}
