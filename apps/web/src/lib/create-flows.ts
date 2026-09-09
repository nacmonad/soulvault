/**
 * Creation wizards (docs/dashboard-ui/009-create-flows.md): treasury create +
 * swarm create as guided wallet-native flows, byte-parity with the CLI paths
 * (story00 §4, story08 §0). Each step = one wallet prompt; partial failure
 * surfaces exactly which steps landed and which remain.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";

import { SWARM_ARTIFACT, TREASURY_ARTIFACT } from "@/lib/contracts-artifacts";
import { addSwarmToOrgList, bindSwarmEnsSubdomain, getAddrMultichain, setAddrMultichain, upsertOrgTreasury } from "@/lib/ens-writes";
import { createSoulVaultPublicClient, getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { deployWalletContract, sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";

const SWARM_ABI = [
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export type StepStatus = "pending" | "signing" | "mining" | "done" | "failed";

export type WizardStep = {
  id: string;
  label: string;
  status: StepStatus;
  txHash?: Hex;
  detail?: string;
};

// ---------------------------------------------------------------------------
// Wizard 1: Treasury create
// ---------------------------------------------------------------------------

export type TreasuryCreateResult = {
  treasuryAddress: Address;
  deployTxHash: Hex;
  ensTxHash: Hex;
  coinType: number;
  treasuryListTxHash: Hex | null;
  blockNumber: bigint;
};

export async function runTreasuryCreate(input: {
  from: Address;
  organizationEnsName: string;
  chainId: number;
  onStep: (stepId: string, update: Partial<WizardStep>) => void;
}): Promise<TreasuryCreateResult> {
  input.onStep("deploy", { status: "signing" });
  const deployed = await deployWalletContract({ from: input.from, bytecode: TREASURY_ARTIFACT.bytecode as Hex });
  input.onStep("deploy", {
    status: "done",
    txHash: deployed.txHash,
    detail: deployed.contractAddress,
  });

  input.onStep("ens", { status: "signing" });
  const ens = await setAddrMultichain({
    from: input.from,
    ensName: input.organizationEnsName,
    chainId: input.chainId,
    address: deployed.contractAddress,
  });
  input.onStep("ens", { status: "done", txHash: ens.txHash, detail: `coinType ${ens.coinType}` });

  input.onStep("treasuryList", { status: "signing" });
  const treasuryListTxHash = await upsertOrgTreasury({
    from: input.from,
    organizationEnsName: input.organizationEnsName,
    entry: {
      chainId: input.chainId,
      address: deployed.contractAddress,
      createdAt: new Date().toISOString(),
    },
  });
  input.onStep("treasuryList", {
    status: "done",
    txHash: treasuryListTxHash ?? undefined,
    detail: treasuryListTxHash ? "soulvault.treasuries updated" : "already listed — no write needed",
  });

  const blockNumber = await receiptBlockOf(deployed.txHash);
  return {
    treasuryAddress: deployed.contractAddress,
    deployTxHash: deployed.txHash,
    ensTxHash: ens.txHash,
    coinType: ens.coinType,
    treasuryListTxHash,
    blockNumber,
  };
}

// ---------------------------------------------------------------------------
// Wizard 2: Swarm create
// ---------------------------------------------------------------------------

export type SwarmTreasuryMode = "discover" | "override" | "none";

export type SwarmCreateResult = {
  swarmAddress: Address;
  swarmEnsName: string;
  deployTxHash: Hex;
  blockNumber: bigint;
  ens?: { subnodeTxHash: Hex; addrTxHash: Hex; chainIdTxHash: Hex; contractTxHash: Hex };
  orgListTxHash: Hex | null;
  boundTreasury: Address;
};

export async function runSwarmCreate(input: {
  from: Address;
  organizationEnsName: string;
  swarmLabel: string;
  treasuryMode: SwarmTreasuryMode;
  treasuryOverride?: Address;
  chainId: number;
  onStep: (stepId: string, update: Partial<WizardStep>) => void;
}): Promise<SwarmCreateResult> {
  const swarmEnsName = `${input.swarmLabel}.${input.organizationEnsName}`;

  // Step 1: resolve the initial treasury (three-mode precedence, mirroring the CLI).
  input.onStep("treasury", { status: "signing" });
  let initialTreasury: Address;
  if (input.treasuryMode === "none") {
    initialTreasury = "0x0000000000000000000000000000000000000000" as Address;
    input.onStep("treasury", { status: "done", detail: "none (stealth) — bind later via setTreasury" });
  } else if (input.treasuryMode === "override") {
    if (!input.treasuryOverride) throw new Error("Treasury override selected but no address given.");
    initialTreasury = input.treasuryOverride;
    input.onStep("treasury", { status: "done", detail: initialTreasury });
  } else {
    const discovered = await getAddrMultichain({
      ensName: input.organizationEnsName,
      chainId: input.chainId,
    });
    if (!discovered) {
      throw new Error(
        `No ENSIP-11 treasury record for ${input.organizationEnsName} at chain ${input.chainId}. ` +
          `Create the treasury first (or pass an explicit address).`,
      );
    }
    initialTreasury = discovered;
    input.onStep("treasury", { status: "done", detail: discovered });
  }

  // Step 2: deploy SoulVaultSwarm(initialTreasury). Creation data = bytecode +
  // headless-abi-encoded constructor arg (no 4-byte selector in initcode).
  input.onStep("deploy", { status: "signing" });
  const creationData = encodeCreationData(SWARM_ARTIFACT.bytecode as Hex, initialTreasury);
  const deployed = await deployWalletContract({ from: input.from, bytecode: creationData });
  input.onStep("deploy", { status: "done", txHash: deployed.txHash, detail: deployed.contractAddress });

  // Step 3–6: ENS binding (subnode + addr + 2 text records in one UI step, 4 txs)
  // then the org list append.
  input.onStep("ens", { status: "signing" });
  const ens = await bindSwarmEnsSubdomain({
    from: input.from,
    organizationEnsName: input.organizationEnsName,
    swarmEnsName,
    contractAddress: deployed.contractAddress,
    chainId: input.chainId,
  });
  input.onStep("ens", { status: "done", txHash: ens.subnodeTxHash, detail: "subnode + addr + 2 text records" });

  input.onStep("orgList", { status: "signing" });
  const orgListTxHash = await addSwarmToOrgList({
    from: input.from,
    organizationEnsName: input.organizationEnsName,
    label: input.swarmLabel,
  });
  input.onStep("orgList", {
    status: "done",
    detail: orgListTxHash ? orgListTxHash : "already listed — no write needed",
    txHash: orgListTxHash ?? undefined,
  });

  // Step 7: read-back verification before declaring success.
  const readClient = publicClient();
  const boundTreasury = (await readClient.readContract({
    address: deployed.contractAddress,
    abi: SWARM_ABI,
    functionName: "treasury",
  })) as Address;
  if (boundTreasury.toLowerCase() !== initialTreasury.toLowerCase()) {
    throw new Error(`Post-deploy check failed: swarm.treasury() = ${boundTreasury}, expected ${initialTreasury}.`);
  }

  const blockNumber = await readClient.getBlockNumber();

  return {
    swarmAddress: deployed.contractAddress,
    swarmEnsName,
    deployTxHash: deployed.txHash,
    blockNumber,
    ens,
    orgListTxHash,
    boundTreasury,
  };
}

/**
 * Creation tx data = contract bytecode + constructor args encoded as a headless
 * ABI tuple (no 4-byte selector — initcode parameters are appended directly).
 */
function encodeCreationData(bytecode: Hex, initialTreasury: Address): Hex {
  const encodedArgs = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "init",
        stateMutability: "nonpayable",
        inputs: [{ name: "initialTreasury", type: "address" }],
        outputs: [],
      },
    ],
    functionName: "init",
    args: [initialTreasury],
  }).slice(10) as Hex; // strip the 4-byte selector, keep the 32-byte word
  return (bytecode + encodedArgs.slice(2)) as Hex;
}

function publicClient() {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) throw new Error("Dashboard config missing — set NEXT_PUBLIC_SOULVAULT_* env vars.");
  return createSoulVaultPublicClient(config);
}

async function receiptBlockOf(hash: Hex): Promise<bigint> {
  const receipt = await waitForWalletReceipt(hash);
  return receipt.blockNumber;
}
