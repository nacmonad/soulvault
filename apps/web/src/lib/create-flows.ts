/**
 * Creation wizards (docs/dashboard-ui/009-create-flows.md): treasury create +
 * swarm create as guided wallet-native flows, byte-parity with the CLI paths
 * (story00 §4, story08 §0). Each step = one wallet prompt; partial failure
 * surfaces exactly which steps landed and which remain.
 */
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { normalize } from "viem/ens";

import { SWARM_ARTIFACT, TREASURY_ARTIFACT, DOCUMENT_REGISTRY_ARTIFACT } from "@/lib/contracts-artifacts";
import { publicClientForChainId } from "@/lib/chains";
import {
  addSwarmToOrgList,
  bindSwarmEnsSubdomain,
  getAddrMultichain,
  namehash,
  RESOLVER_ABI,
  resolveOrgResolver,
  setAddrMultichain,
  upsertDocumentRegistryEnsRecord,
  upsertOrgTreasury,
} from "@/lib/ens-writes";
import { createSoulVaultPublicClient, getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { sendWalletTransaction, deployWalletContract, waitForWalletReceipt } from "@/lib/wallet-tx";
import {
  asDocHash,
  WRITE_ABI,
  resolveDocumentRegistryAddress,
  type DocumentRegistrySource,
} from "@/lib/document-registry";

const SWARM_ABI = [
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const SWARM_CONTRACT_TEXT_KEY = "soulvault.swarmContract";

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
  // Deploy on the chosen chain; ENS steps below are pinned to Sepolia by
  // ens-writes.ts (ENS coordination is always Sepolia, per the ENS-native epic).
  input.onStep("deploy", { status: "signing" });
  const deployed = await deployWalletContract({
    from: input.from,
    bytecode: TREASURY_ARTIFACT.bytecode as Hex,
    chainId: input.chainId,
  });
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

  // Block comes from the deploy receipt itself — never re-read cross-chain.
  return {
    treasuryAddress: deployed.contractAddress,
    deployTxHash: deployed.txHash,
    ensTxHash: ens.txHash,
    coinType: ens.coinType,
    treasuryListTxHash,
    blockNumber: deployed.blockNumber,
  };
}

// ---------------------------------------------------------------------------
// Wizard 2: Swarm create
// ---------------------------------------------------------------------------

export type SwarmTreasuryMode = "discover" | "override" | "none";

export type SwarmCreateResult = {
  swarmAddress: Address;
  swarmEnsName: string;
  /** Null when an existing deployment was adopted (nothing was deployed this run). */
  deployTxHash: Hex | null;
  /** 0n when an existing deployment was adopted. */
  blockNumber: bigint;
  ens?: { subnodeTxHash: Hex; addrTxHash: Hex; chainIdTxHash: Hex; contractTxHash: Hex };
  orgListTxHash: Hex | null;
  boundTreasury: Address;
};

/** First sentinel-free tx hash, or undefined when every sub-step was skipped. */
function firstRealTxHash(hashes: Hex[]): Hex | undefined {
  return hashes.find((h) => h && h !== "0x");
}

export type ExistingSwarmDeployment = {
  swarmAddress: Address;
  treasury: Address;
  treasuryMatches: boolean;
};

/**
 * Read-only adoption probe (ticket 016): does `<label>.<org>` already point at
 * a live SoulVaultSwarm? Checks the swarm node's ENSIP `addr` record and the
 * `soulvault.swarmContract` text record on the org's resolver (v2 orgs use
 * their PermissionedResolver; v1 orgs the public one — resolveOrgResolver
 * picks). A candidate only counts when `treasury()` answers (i.e. it is a
 * SoulVaultSwarm, not some other contract squatting on the record). Returns
 * null when nothing on-chain claims the name. All reads — no wallet prompt.
 */
export async function findExistingSwarmDeployment(input: {
  from: Address;
  organizationEnsName: string;
  swarmEnsName: string;
  expectedTreasury: Address;
}): Promise<ExistingSwarmDeployment | null> {
  const client = publicClient();
  const resolver = await resolveOrgResolver(input.organizationEnsName, input.from).catch(() => null);
  if (!resolver) return null;
  const swarmNode = namehash(normalize(input.swarmEnsName));
  const addrOnchain = (await client
    .readContract({
      address: resolver,
      abi: RESOLVER_ABI,
      functionName: "addr",
      args: [swarmNode],
    })
    .catch(() => null)) as Address | null;
  const contractText = (await client
    .readContract({
      address: resolver,
      abi: RESOLVER_ABI,
      functionName: "text",
      args: [swarmNode, SWARM_CONTRACT_TEXT_KEY],
    })
    .catch(() => null)) as string | null;

  const candidates: Address[] = [];
  for (const raw of [addrOnchain, contractText as Address | null]) {
    if (!raw) continue;
    try {
      const candidate = getAddress(raw);
      if (!candidates.some((c) => c.toLowerCase() === candidate.toLowerCase())) candidates.push(candidate);
    } catch {
      // malformed record — ignore
    }
  }

  for (const candidate of candidates) {
    const treasury = (await client
      .readContract({
        address: candidate,
        abi: SWARM_ABI,
        functionName: "treasury",
      })
      .catch(() => null)) as Address | null;
    if (treasury === null) continue; // not a SoulVaultSwarm
    return {
      swarmAddress: candidate,
      treasury,
      treasuryMatches: treasury.toLowerCase() === input.expectedTreasury.toLowerCase(),
    };
  }
  return null;
}

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
      // v2 orgs without a v1-resolvable pointer record need the sender to
      // locate their resolver via the CREATE2 recompute.
      from: input.from,
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
  //
  // Idempotent re-run (ticket 016, mirroring the org wizard's step-1 probe):
  // when the swarm subdomain already resolves to a live SoulVaultSwarm whose
  // bound treasury matches what we just resolved, adopt it — never re-deploy.
  // A fresh deploy here would orphan the ENS records (the bind step would then
  // repoint them) and leave a second swarm the org list already maps.
  input.onStep("deploy", { status: "signing" });
  const existing = await findExistingSwarmDeployment({
    from: input.from,
    organizationEnsName: input.organizationEnsName,
    swarmEnsName,
    expectedTreasury: initialTreasury,
  });
  let deployed: { txHash: Hex | null; contractAddress: Address; blockNumber: bigint };
  if (existing) {
    if (existing.treasuryMatches) {
      input.onStep("deploy", {
        status: "done",
        detail: `${existing.swarmAddress} (already deployed — adopted)`,
      });
      deployed = { txHash: null, contractAddress: existing.swarmAddress, blockNumber: 0n };
    } else {
      throw new Error(
        `${swarmEnsName} already resolves to ${existing.swarmAddress}, bound to treasury ` +
          `${existing.treasury} — but this run resolved ${initialTreasury}. Adopting would ` +
          `rebind it to a different treasury. Either run the wizard with a matching treasury ` +
          `binding, or unpublish the swarm first (CLI: swarm unpublish).`,
      );
    }
  } else {
    const creationData = encodeCreationData(SWARM_ARTIFACT.bytecode as Hex, initialTreasury);
    const fresh = await deployWalletContract({
      from: input.from,
      bytecode: creationData,
      chainId: input.chainId,
    });
    deployed = { txHash: fresh.txHash, contractAddress: fresh.contractAddress, blockNumber: fresh.blockNumber };
    input.onStep("deploy", { status: "done", txHash: fresh.txHash, detail: fresh.contractAddress });
  }

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
  input.onStep("ens", {
    status: "done",
    // Skipped sub-steps carry the "0x" sentinel — link the first tx that was
    // actually signed (or none when every record already matched on-chain).
    txHash: firstRealTxHash([ens.subnodeTxHash, ens.addrTxHash, ens.chainIdTxHash, ens.contractTxHash]),
    detail: "subnode + addr + 2 text records (only diffs written)",
  });

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

  // Step 7: read-back verification before declaring success — on the chain the
  // swarm actually deployed to (ENS reads stay on Sepolia).
  const readClient = publicClientForChainId(input.chainId) ?? publicClient();
  const boundTreasury = (await readClient.readContract({
    address: deployed.contractAddress,
    abi: SWARM_ABI,
    functionName: "treasury",
  })) as Address;
  if (boundTreasury.toLowerCase() !== initialTreasury.toLowerCase()) {
    throw new Error(`Post-deploy check failed: swarm.treasury() = ${boundTreasury}, expected ${initialTreasury}.`);
  }

  return {
    swarmAddress: deployed.contractAddress,
    swarmEnsName,
    deployTxHash: deployed.txHash,
    blockNumber: deployed.blockNumber,
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
  }).slice(10) as Hex; // strip the 4-byte selector, keep the 32-byte word — NOTE: no `0x` prefix after this (same hazard as ens-register-v2.ts computeVerifiableProxyAddress, fixed in 0d07d92)
  return (bytecode + encodedArgs) as Hex;
}

function publicClient() {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) throw new Error("Dashboard config missing — set NEXT_PUBLIC_SOULVAULT_* env vars.");
  return createSoulVaultPublicClient(config);
}

// ---------------------------------------------------------------------------
// Wizard 3: DocumentRegistry deploy (ticket 012 §D v1)
// ---------------------------------------------------------------------------

export type DocumentRegistryDeployResult = {
  registryAddress: Address;
  deployTxHash: Hex;
  blockNumber: bigint;
  coinType: number;
  ensAddrTxHash: Hex;
  recordTxHash: Hex | null;
};

/**
 * Deploy the global SoulVaultDocumentRegistry singleton and announce it on the
 * protocol root ENS name: ENSIP-11 addr(root, coinType(chainId)) — the record
 * `resolveDocumentRegistryAddress()` reads — plus the `soulvault.documentRegistry`
 * text record carrying the deploy block for event scan windows. The connected
 * wallet must own the root name (protocol infrastructure, not an org asset).
 */
export async function runDocumentRegistryDeploy(input: {
  from: Address;
  rootEnsName: string;
  chainId: number;
  onStep: (stepId: string, update: Partial<WizardStep>) => void;
}): Promise<DocumentRegistryDeployResult> {
  input.onStep("deploy", { status: "signing" });
  const deployed = await deployWalletContract({
    from: input.from,
    bytecode: DOCUMENT_REGISTRY_ARTIFACT.bytecode as Hex,
    chainId: input.chainId,
  });
  input.onStep("deploy", {
    status: "done",
    txHash: deployed.txHash,
    detail: deployed.contractAddress,
  });

  input.onStep("ens", { status: "signing" });
  const ens = await setAddrMultichain({
    from: input.from,
    ensName: input.rootEnsName,
    chainId: input.chainId,
    address: deployed.contractAddress,
  });
  input.onStep("ens", {
    status: "done",
    txHash: ens.txHash,
    detail: `coinType ${ens.coinType}`,
  });

  input.onStep("record", { status: "signing" });
  const recordTxHash = await upsertDocumentRegistryEnsRecord({
    from: input.from,
    rootEnsName: input.rootEnsName,
    entry: {
      chainId: input.chainId,
      address: deployed.contractAddress,
      deployedAtBlock: Number(deployed.blockNumber),
      deployedAt: new Date().toISOString(),
    },
  });
  input.onStep("record", {
    status: "done",
    txHash: recordTxHash ?? undefined,
    detail: recordTxHash ? "soulvault.documentRegistry updated" : "already recorded — no write needed",
  });

  return {
    registryAddress: deployed.contractAddress,
    deployTxHash: deployed.txHash,
    blockNumber: deployed.blockNumber,
    coinType: ens.coinType,
    ensAddrTxHash: ens.txHash,
    recordTxHash,
  };
}

// ---------------------------------------------------------------------------
// Wizard 4: Document publish (redact page — ticket 012 documents lane)
// ---------------------------------------------------------------------------

export type DocumentPublishResult = {
  registry: Address;
  registrySource: DocumentRegistrySource;
  docHash: Hex;
  txHash: Hex;
  blockNumber: bigint;
};

/**
 * Anchor a redacted document on the DocumentRegistry:
 * publishDocument(docHash, slotIds) → DocumentPublished. One wallet signature.
 * Routes through the shared transaction channel (same signer + preflight as the
 * deploy wizards, not a bespoke inline path), then waits for the receipt — a
 * publish is only "done" when the event is actually on-chain.
 */
export async function runDocumentPublish(input: {
  from: Address;
  documentId: string;
  slotIds: string[];
  onStep: (stepId: string, update: Partial<WizardStep>) => void;
}): Promise<DocumentPublishResult> {
  input.onStep("resolve", { status: "signing" });
  const { address: registry, source } = await resolveDocumentRegistryAddress({ viewer: input.from });
  if (!registry) {
    input.onStep("resolve", { status: "failed" });
    throw new Error(
      "No document registry discovered on ENS. Deploy one from the Documents page first.",
    );
  }
  input.onStep("resolve", { status: "done", detail: `${registry} · via ${source}` });

  const docHash = asDocHash(input.documentId);
  const data = encodeFunctionData({
    abi: WRITE_ABI,
    functionName: "publishDocument",
    args: [docHash, input.slotIds],
  });

  input.onStep("publish", { status: "signing" });
  const txHash = await sendWalletTransaction({ from: input.from, to: registry, data });
  input.onStep("publish", { status: "mining", txHash });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") {
    throw new Error(`Publish transaction reverted (tx ${txHash}).`);
  }
  input.onStep("publish", { status: "done", txHash, detail: `block ${receipt.blockNumber}` });

  return { registry, registrySource: source, docHash, txHash, blockNumber: receipt.blockNumber };
}
