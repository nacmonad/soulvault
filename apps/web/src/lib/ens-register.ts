/**
 * Browser port of `packages/node/src/ens-name.ts` registerOrganizationEns.
 * Commit → wait minCommitmentAge → register on Sepolia, then unwrap NameWrapper
 * if present and write `class` / `name` text records. No ~/.soulvault writes.
 */
import {
  encodeFunctionData,
  keccak256,
  stringToBytes,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { normalize } from "viem/ens";

import { SEPOLIA_CHAIN_ID } from "@/lib/chains";
import {
  ETH_REGISTRAR_CONTROLLER,
  ENS_REGISTRY,
  PUBLIC_RESOLVER,
  REGISTRY_ABI,
  RESOLVER_ABI,
  namehash,
} from "@/lib/ens-writes";
import { createSoulVaultPublicClient, getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";

export const ONE_YEAR_SECONDS = 31_536_000n;
export const ORG_ENS_CLASS_VALUE = "soulvault.organization";

const REGISTRATION_COMPONENTS = [
  { name: "label", type: "string" },
  { name: "owner", type: "address" },
  { name: "duration", type: "uint256" },
  { name: "secret", type: "bytes32" },
  { name: "resolver", type: "address" },
  { name: "data", type: "bytes[]" },
  { name: "reverseRecord", type: "uint8" },
  { name: "referrer", type: "bytes32" },
] as const;

export const CONTROLLER_ABI = [
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "valid",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "minCommitmentAge",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rentPrice",
    stateMutability: "view",
    inputs: [
      { name: "label", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "base", type: "uint256" },
          { name: "premium", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "makeCommitment",
    stateMutability: "pure",
    inputs: [{ name: "registration", type: "tuple", components: REGISTRATION_COMPONENTS }],
    outputs: [{ name: "commitment", type: "bytes32" }],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [{ name: "registration", type: "tuple", components: REGISTRATION_COMPONENTS }],
    outputs: [],
  },
  {
    type: "function",
    name: "nameWrapper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const NAME_WRAPPER_ABI = [
  {
    type: "function",
    name: "unwrapETH2LD",
    stateMutability: "nonpayable",
    inputs: [
      { name: "labelhash", type: "bytes32" },
      { name: "registrant", type: "address" },
      { name: "controller", type: "address" },
    ],
    outputs: [],
  },
] as const;

export type Registration = {
  label: string;
  owner: Address;
  duration: bigint;
  secret: Hex;
  resolver: Address;
  data: Hex[];
  reverseRecord: number;
  referrer: Hex;
};

export type EnsAvailability = {
  name: string;
  label: string;
  node: Hex;
  owner: Address;
  available: boolean;
  valid: boolean;
};

function publicClient(): PublicClient {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) throw new Error("SoulVault dashboard config missing — set NEXT_PUBLIC_SOULVAULT_* env vars.");
  return createSoulVaultPublicClient(config);
}

/** Root `.eth` 2LD only, matching `normalizeRootEthEnsName` in packages/node. */
export function parseEthRootLabel(name: string): { normalized: string; label: string } {
  const normalized = normalize(name.trim());
  const parts = normalized.split(".");
  if (parts.length !== 2 || parts[1] !== "eth" || !parts[0]) {
    throw new Error(`Only root .eth names are supported. Got: ${name}`);
  }
  return { normalized, label: parts[0] };
}

/** 110% of (base + premium), same buffer as the CLI. */
export function registrationValueWei(base: bigint, premium: bigint): bigint {
  return ((base + premium) * 110n) / 100n;
}

export function newRegistrationSecret(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function checkEnsNameAvailability(name: string): Promise<EnsAvailability> {
  const { normalized, label } = parseEthRootLabel(name);
  const client = publicClient();
  const node = namehash(normalized);
  const [owner, available, valid] = await Promise.all([
    client.readContract({
      address: ENS_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "owner",
      args: [node],
    }),
    client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "available",
      args: [label],
    }),
    client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "valid",
      args: [label],
    }),
  ]);
  return {
    name: normalized,
    label,
    node,
    owner,
    valid,
    available: Boolean(valid && available && (!owner || owner === zeroAddress)),
  };
}

export async function quoteRegistration(label: string): Promise<{
  minCommitmentAge: bigint;
  valueWei: bigint;
  base: bigint;
  premium: bigint;
}> {
  const client = publicClient();
  const [minCommitmentAge, price] = await Promise.all([
    client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "minCommitmentAge",
    }),
    client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "rentPrice",
      args: [label, ONE_YEAR_SECONDS],
    }),
  ]);
  return {
    minCommitmentAge,
    base: price.base,
    premium: price.premium,
    valueWei: registrationValueWei(price.base, price.premium),
  };
}

async function makeCommitment(registration: Registration): Promise<Hex> {
  const client = publicClient();
  return client.readContract({
    address: ETH_REGISTRAR_CONTROLLER,
    abi: CONTROLLER_ABI,
    functionName: "makeCommitment",
    args: [registration],
  });
}

async function sleepCommitmentMaturation(
  totalSec: number,
  onTick: (remaining: number) => void,
): Promise<void> {
  const n = Math.max(1, Math.floor(totalSec));
  let remaining = n;
  onTick(remaining);
  while (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    remaining -= 1;
    onTick(remaining);
  }
}

async function sendAndWait(input: {
  from: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}): Promise<Hex> {
  const txHash = await sendWalletTransaction({
    chainId: SEPOLIA_CHAIN_ID,
    from: input.from,
    to: input.to,
    data: input.data,
    ...(input.value !== undefined ? { value: input.value } : {}),
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted (tx ${txHash}).`);
  }
  return txHash;
}

export async function unwrapIfWrapped(input: { from: Address; label: string }): Promise<Hex | null> {
  const client = publicClient();
  let wrapper: Address;
  try {
    wrapper = await client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "nameWrapper",
    });
  } catch {
    return null;
  }
  if (!wrapper || wrapper === zeroAddress) return null;
  const labelHash = keccak256(stringToBytes(input.label));
  return sendAndWait({
    from: input.from,
    to: wrapper,
    data: encodeFunctionData({
      abi: NAME_WRAPPER_ABI,
      functionName: "unwrapETH2LD",
      args: [labelHash, input.from, input.from],
    }),
  });
}

export async function writeOrgMetadataRecords(input: {
  from: Address;
  ensName: string;
  displayName: string;
}): Promise<{ classTxHash: Hex; nameTxHash: Hex }> {
  const node = namehash(normalize(input.ensName));
  const classTxHash = await sendAndWait({
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, "class", ORG_ENS_CLASS_VALUE],
    }),
  });
  const nameTxHash = await sendAndWait({
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, "name", input.displayName],
    }),
  });
  return { classTxHash, nameTxHash };
}

export type OrgRegisterResult = {
  ensName: string;
  ownerAddress: Address;
  alreadyOwned: boolean;
  commitTxHash: Hex | null;
  registerTxHash: Hex | null;
  unwrapTxHash: Hex | null;
  classTxHash: Hex | null;
  nameTxHash: Hex | null;
  amountWei: bigint | null;
};

export type OrgRegisterStepId = "check" | "commit" | "wait" | "register" | "unwrap" | "metadata";

export async function registerOrganizationEns(input: {
  from: Address;
  displayName: string;
  ensName: string;
  onStep: (stepId: OrgRegisterStepId, update: { status: string; txHash?: Hex; detail?: string }) => void;
}): Promise<OrgRegisterResult> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("Organization name is required.");

  input.onStep("check", { status: "signing" });
  const availability = await checkEnsNameAvailability(input.ensName);
  if (!availability.valid) {
    throw new Error(`ENS name "${availability.name}" is not a valid .eth label.`);
  }

  const ownedByCaller = availability.owner.toLowerCase() === input.from.toLowerCase();
  if (!availability.available && !ownedByCaller) {
    throw new Error(
      `ENS name "${availability.name}" is not available (owner ${availability.owner}). Pick a different name.`,
    );
  }

  const result: OrgRegisterResult = {
    ensName: availability.name,
    ownerAddress: input.from,
    alreadyOwned: ownedByCaller,
    commitTxHash: null,
    registerTxHash: null,
    unwrapTxHash: null,
    classTxHash: null,
    nameTxHash: null,
    amountWei: null,
  };

  if (ownedByCaller) {
    input.onStep("check", { status: "done", detail: "already owned by this wallet" });
    input.onStep("commit", { status: "done", detail: "skipped" });
    input.onStep("wait", { status: "done", detail: "skipped" });
    input.onStep("register", { status: "done", detail: "skipped" });
    input.onStep("unwrap", { status: "done", detail: "skipped" });
  } else {
    input.onStep("check", { status: "done", detail: availability.name });
    const quote = await quoteRegistration(availability.label);
    result.amountWei = quote.valueWei;
    const registration: Registration = {
      label: availability.label,
      owner: input.from,
      duration: ONE_YEAR_SECONDS,
      secret: newRegistrationSecret(),
      resolver: PUBLIC_RESOLVER,
      data: [],
      reverseRecord: 0,
      referrer: zeroHash,
    };
    const commitment = await makeCommitment(registration);

    input.onStep("commit", { status: "signing" });
    result.commitTxHash = await sendAndWait({
      from: input.from,
      to: ETH_REGISTRAR_CONTROLLER,
      data: encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "commit",
        args: [commitment],
      }),
    });
    input.onStep("commit", { status: "done", txHash: result.commitTxHash });

    const waitSec = Number(quote.minCommitmentAge + 1n);
    input.onStep("wait", { status: "mining", detail: `${waitSec}s` });
    await sleepCommitmentMaturation(waitSec, (remaining) => {
      input.onStep("wait", { status: "mining", detail: `${remaining}s` });
    });
    input.onStep("wait", { status: "done", detail: `${waitSec}s` });

    input.onStep("register", { status: "signing", detail: `${quote.valueWei.toString()} wei` });
    result.registerTxHash = await sendAndWait({
      from: input.from,
      to: ETH_REGISTRAR_CONTROLLER,
      data: encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "register",
        args: [registration],
      }),
      value: quote.valueWei,
    });
    input.onStep("register", { status: "done", txHash: result.registerTxHash });

    input.onStep("unwrap", { status: "signing" });
    result.unwrapTxHash = await unwrapIfWrapped({ from: input.from, label: availability.label });
    input.onStep("unwrap", {
      status: "done",
      txHash: result.unwrapTxHash ?? undefined,
      detail: result.unwrapTxHash ? undefined : "not wrapped",
    });
  }

  input.onStep("metadata", { status: "signing" });
  try {
    const meta = await writeOrgMetadataRecords({
      from: input.from,
      ensName: availability.name,
      displayName,
    });
    result.classTxHash = meta.classTxHash;
    result.nameTxHash = meta.nameTxHash;
    input.onStep("metadata", { status: "done", txHash: meta.classTxHash });
  } catch (error) {
    if (ownedByCaller) throw error;
    input.onStep("metadata", {
      status: "failed",
      detail: error instanceof Error ? error.message : "metadata write failed",
    });
  }

  return result;
}
