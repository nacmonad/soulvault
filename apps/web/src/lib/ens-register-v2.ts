// ENSv2 org registration (docs/ensv2-integration-spec.md §4) — browser port of
// packages/node/src/ensv2-registry.ts. Structurally different from the v1
// commit/reveal flow (ens-register.ts): no controller, no commitment wait, no
// unwrap. Steps = deploy org registry via the VerifiableFactory → register the
// name in it with epoch-bound expiry → mirror the registry address on the org
// name's resolver → metadata records.
//
// Protocol detection (backwards compat): the v2 registry address is mirrored
// under the `soulvault.ensv2Registry` text record on the org name. Presence ⇒
// v2, absence ⇒ v1 — orgs built on the legacy controller keep using the v1
// wizard untouched.
import {
  encodeFunctionData,
  getAddress,
  labelhash,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { normalize } from "viem/ens";

import {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig,
} from "@/lib/onchain/client";
import { sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";

// --- Shared ENSv2 Sepolia beta addresses (parity with packages/node ensv2-registry.ts).

export const ENSV2_SHARED_ADDRESSES = {
  userRegistryImpl: "0x624a25d67b59d587752ebec8dded8827dae52050",
  verifiableFactory: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef",
} as const;

/** Runtime overrides (browser equivalent of the node env vars). */
export function getEnsV2SharedAddresses(): typeof ENSV2_SHARED_ADDRESSES {
  if (typeof window === "undefined") return ENSV2_SHARED_ADDRESSES;
  try {
    const raw = window.localStorage.getItem("soulvault.ensv2SharedAddresses");
    if (!raw) return ENSV2_SHARED_ADDRESSES;
    const parsed = JSON.parse(raw) as Partial<typeof ENSV2_SHARED_ADDRESSES>;
    return { ...ENSV2_SHARED_ADDRESSES, ...parsed };
  } catch {
    return ENSV2_SHARED_ADDRESSES;
  }
}

// --- ABIs (pinned @ contracts-v2 97a5729, parity with the node package).

export const ENSV2_VERIFIABLE_FACTORY_ABI = [
  {
    type: "function",
    name: "deployProxy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "salt", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
] as const;

export const ENSV2_USER_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "hasRoles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const INITIALIZE_ABI = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rootAccount", type: "address" },
      { name: "roleBitmap", type: "uint256" },
    ],
  },
] as const;

// --- Role constants (parity: RegistryRolesLib + EACBaseRolesLib).

export const ENSV2_ROLES = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_RENEW: 1n << 16n,
  ROLE_SET_RESOLVER: 1n << 24n,
} as const;

/** EACBaseRolesLib.ALL_ROLES — bit 0 set in every nybble (64 role slots). */
export const EAC_ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;

/** Roles granted to the org owner on the name's resource at registration. */
export const ORG_NAME_ROLES =
  ENSV2_ROLES.ROLE_SET_RESOLVER | ENSV2_ROLES.ROLE_RENEW;

/** Text record key that marks an org as ENSv2-managed (detection mirror). */
export const ENSV2_REGISTRY_TEXT_KEY = "soulvault.ensv2Registry";

export const DEFAULT_EPOCH_SECONDS = 30 * 24 * 60 * 60; // 30d epoch cadence

// --- Pure helpers.

export function parseEnsV2OrgLabel(name: string): { normalized: string; label: string } {
  const normalized = normalize(name.trim());
  if (!normalized.endsWith(".eth")) {
    throw new Error(`ENSv2 org name must end in .eth (got ${normalized})`);
  }
  const label = normalized.slice(0, -4);
  if (!label || label.includes(".")) {
    throw new Error(
      `ENSv2 org name must be a single label under .eth (got ${normalized})`,
    );
  }
  return { normalized, label };
}

export function expiryFromNow(epochSeconds: number, nowSeconds?: number): bigint {
  const now = BigInt(nowSeconds ?? Math.floor(Date.now() / 1000));
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    throw new Error(`expiry must be a positive number of seconds (got ${epochSeconds})`);
  }
  return now + BigInt(Math.floor(epochSeconds));
}

/** Deterministic CREATE2 salt per org label — redeploys converge, clashes fail loudly. */
export function orgRegistrySalt(label: string): bigint {
  return BigInt(labelhash(label));
}

export function encodeInitializeData(owner: Address): Hex {
  return encodeFunctionData({
    abi: INITIALIZE_ABI,
    functionName: "initialize",
    args: [owner, EAC_ALL_ROLES],
  });
}

/** Encode/decode the `soulvault.ensv2Registry` text record payload. */
export function encodeEnsV2RegistryRecord(input: {
  registry: Address;
  owner: Address;
  deployedAt?: string;
}): string {
  return JSON.stringify({
    version: 2,
    registry: getAddress(input.registry),
    owner: getAddress(input.owner),
    ...(input.deployedAt ? { deployedAt: input.deployedAt } : {}),
  });
}

export function decodeEnsV2RegistryRecord(
  value: string,
): { registry: Address; owner: Address; deployedAt?: string } | null {
  try {
    const parsed = JSON.parse(value) as {
      version?: number;
      registry?: string;
      owner?: string;
      deployedAt?: string;
    };
    if (parsed.version !== 2 || !parsed.registry || !parsed.owner) return null;
    return {
      registry: getAddress(parsed.registry),
      owner: getAddress(parsed.owner),
      ...(parsed.deployedAt ? { deployedAt: parsed.deployedAt } : {}),
    };
  } catch {
    return null;
  }
}

// --- Detection: which protocol does this org name already speak?

export type OrgEnsVersion = "v2" | "v1";

export async function readEnsV2RegistryRecord(orgName: string): Promise<{
  registry: Address;
  owner: Address;
  deployedAt?: string;
} | null> {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) return null;
  const client = createSoulVaultPublicClient(config);
  const { getEnsText } = await import("viem/ens");
  const value = await client
    .getEnsText({ name: normalize(orgName), key: ENSV2_REGISTRY_TEXT_KEY })
    .catch(() => null);
  if (!value) return null;
  return decodeEnsV2RegistryRecord(value);
}

export async function detectOrgEnsVersion(orgName: string): Promise<OrgEnsVersion> {
  const record = await readEnsV2RegistryRecord(orgName).catch(() => null);
  return record ? "v2" : "v1";
}

// --- Registration flow (one wallet prompt per step).

export type EnsV2RegisterStepId = "deploy" | "register" | "mirror" | "metadata";

export type EnsV2OrgRegisterResult = {
  ensName: string;
  registryAddress: Address;
  owner: Address;
  expiry: bigint;
  txHashes: Partial<Record<EnsV2RegisterStepId, Hex>>;
};

export async function registerOrganizationEnsV2(input: {
  from: Address;
  displayName: string;
  ensName: string;
  epochSeconds?: number;
  onStep?: (stepId: EnsV2RegisterStepId, update: { status: "active" | "done"; detail?: string }) => void;
}): Promise<EnsV2OrgRegisterResult> {
  const { normalized, label } = parseEnsV2OrgLabel(input.ensName);
  const owner = getAddress(input.from);
  const epochSeconds = input.epochSeconds ?? DEFAULT_EPOCH_SECONDS;
  const shared = getEnsV2SharedAddresses();
  const txHashes: Partial<Record<EnsV2RegisterStepId, Hex>> = {};

  // Step 1 — deploy the org's UserRegistry proxy via the VerifiableFactory.
  // The factory enforces verifiable proxy deployment (CREATE2 from the pinned
  // factory ⇒ anyone can recompute the address and confirm no hidden init).
  // The registry pointer record on the org name mirrors the org profile's
  // `ensv2Registry` (packages/node organization.ts) — one source of truth for
  // detection on both sides.
  input.onStep?.("deploy", { status: "active" });
  const deployData = encodeInitializeData(owner);
  const deployHash = await sendWalletTransaction({
    from: owner,
    to: shared.verifiableFactory as Address,
    data: encodeFunctionData({
      abi: ENSV2_VERIFIABLE_FACTORY_ABI,
      functionName: "deployProxy",
      args: [shared.userRegistryImpl as Address, orgRegistrySalt(label), deployData],
    }),
  });
  const deployReceipt = await waitForWalletReceipt(deployHash);
  if (deployReceipt.status !== "success") {
    throw new Error(`Registry deploy reverted (tx ${deployHash}).`);
  }
  const registryAddress = deployReceipt.contractAddress
    ? getAddress(deployReceipt.contractAddress)
    : await resolveProxyAddressFromLogs(deployHash);
  if (!registryAddress) {
    throw new Error(
      `deployProxy succeeded but the proxy address could not be parsed (tx ${deployHash}).`,
    );
  }
  txHashes.deploy = deployHash;
  input.onStep?.("deploy", { status: "done", detail: registryAddress });

  // Post-deploy verification — same trust rule as the node package: only trust
  // the registry if it really granted the owner ROLE_REGISTRAR on root.
  const client = createSoulVaultPublicClient(getBrowserSoulVaultClientConfig()!);
  const rootHasRegistrar = await client.readContract({
    address: registryAddress,
    abi: ENSV2_USER_REGISTRY_ABI,
    functionName: "hasRoles",
    args: [0n, ENSV2_ROLES.ROLE_REGISTRAR, owner],
  });
  if (!rootHasRegistrar) {
    throw new Error(
      `Deployed registry ${registryAddress} does not grant ROLE_REGISTRAR on root — refusing to continue.`,
    );
  }

  // Step 2 — register the org name in the new registry with epoch-bound expiry.
  input.onStep?.("register", { status: "active" });
  const expiry = expiryFromNow(epochSeconds);
  const registerHash = await sendWalletTransaction({
    from: owner,
    to: registryAddress,
    data: encodeFunctionData({
      abi: ENSV2_USER_REGISTRY_ABI,
      functionName: "register",
      args: [label, owner, zeroAddress, zeroAddress, ORG_NAME_ROLES, expiry],
    }),
  });
  const registerReceipt = await waitForWalletReceipt(registerHash);
  if (registerReceipt.status !== "success") {
    throw new Error(`Org name registration reverted (tx ${registerHash}).`);
  }
  txHashes.register = registerHash;
  input.onStep?.("register", { status: "done" });

  // Step 3 — mirror the registry address on the org name's resolver so any
  // reader (and this wizard's auto-detect) can discover the v2 protocol.
  input.onStep?.("mirror", { status: "active" });
  const mirrorHash = await writeEnsV2RegistryPointer({
    from: owner,
    orgName: normalized,
    record: encodeEnsV2RegistryRecord({
      registry: registryAddress,
      owner,
      deployedAt: new Date().toISOString(),
    }),
  });
  if (mirrorHash) {
    const mirrorReceipt = await waitForWalletReceipt(mirrorHash);
    if (mirrorReceipt.status !== "success") {
      throw new Error(`Registry pointer write reverted (tx ${mirrorHash}).`);
    }
    txHashes.mirror = mirrorHash;
  }
  input.onStep?.("mirror", { status: "done" });

  // Step 4 — metadata records (same keys as the v1 wizard + CLI).
  input.onStep?.("metadata", { status: "active" });
  const metadataHash = await writeOrgMetadataRecordsV2({
    from: owner,
    orgName: normalized,
    displayName: input.displayName,
  });
  if (metadataHash) {
    const metadataReceipt = await waitForWalletReceipt(metadataHash);
    if (metadataReceipt.status !== "success") {
      throw new Error(`Metadata record write reverted (tx ${metadataHash}).`);
    }
    txHashes.metadata = metadataHash;
  }
  input.onStep?.("metadata", { status: "done" });

  return {
    ensName: normalized,
    registryAddress,
    owner,
    expiry,
    txHashes,
  };
}

/**
 * Parse the proxy address from the deployProxy receipt. The deploy is a CALL to
 * the VerifiableFactory, so receipt.contractAddress is never set (that field is
 * only populated for direct contract-creation txs). Two sources, in order:
 *   1. The factory's ProxyDeployed(Owner,proxy) event — emitter == the pinned
 *      factory, proxy address in topics[2]. Most precise.
 *   2. The first log emitted by a contract other than the factory — the proxy
 *      emits its own initialization logs (initialize() storage writes/events).
 * Mirrors packages/node ensv2-registry.ts resolveProxyAddressFromReceipt.
 */
const PROXY_DEPLOYED_TOPIC =
  "0x0a2c575ff341b41da136c9ccae74ec230a927a024d18f0dccf46d123f28f5f54"; // ProxyDeployed(address,address)

async function resolveProxyAddressFromLogs(txHash: Hex): Promise<Address | null> {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) return null;
  const url = config.rpcUrl.split(",")[0]?.trim();
  if (!url) return null;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }),
  });
  const body = (await response.json()) as {
    result?: {
      contractAddress?: string | null;
      logs?: Array<{ address?: string; topics?: string[] }> | null;
    } | null;
  };
  const receipt = body.result;
  if (!receipt) return null;

  const factory = getEnsV2SharedAddresses().verifiableFactory;

  // 1) Factory's ProxyDeployed event: topics = [sig, owner, proxy].
  const deployed = receipt.logs?.find(
    (log) =>
      log.address &&
      log.address.toLowerCase() === factory.toLowerCase() &&
      log.topics?.[0]?.toLowerCase() === PROXY_DEPLOYED_TOPIC &&
      log.topics.length >= 3,
  );
  if (deployed?.topics?.[2]) {
    const proxy = `0x${deployed.topics[2].slice(-40)}`;
    if (proxy !== zeroAddress) return getAddress(proxy);
  }

  // 2) First log emitted by anything that isn't the factory (the proxy's own
  //    initialization logs come FROM the proxy).
  const firstProxyLog = receipt.logs?.find(
    (log) =>
      log.address &&
      log.address !== zeroAddress &&
      log.address.toLowerCase() !== factory.toLowerCase(),
  );
  if (firstProxyLog?.address) return getAddress(firstProxyLog.address);

  // Direct-creation fallback (defensive; not expected for factory deploys).
  if (receipt.contractAddress && receipt.contractAddress !== zeroAddress) {
    return getAddress(receipt.contractAddress);
  }
  return null;
}

/**
 * Write the `soulvault.ensv2Registry` pointer on the org name's resolver.
 * Best-effort: if the org name has no resolver yet (possible when registering a
 * freshly deployed name), the step is skipped and the caller can set records later.
 */
async function writeEnsV2RegistryPointer(input: {
  from: Address;
  orgName: string;
  record: string;
}): Promise<Hex | null> {
  const client = createSoulVaultPublicClient(getBrowserSoulVaultClientConfig()!);
  const { getEnsResolver } = await import("viem/ens");
  const resolver = await client
    .getEnsResolver({ name: input.orgName })
    .catch(() => null);
  if (!resolver || resolver === zeroAddress) return null;
  return sendWalletTransaction({
    from: input.from,
    to: resolver,
    data: encodeFunctionData({
      abi: SET_TEXT_ABI,
      functionName: "setText",
      args: [labelhash(normalize(input.orgName)), ENSV2_REGISTRY_TEXT_KEY, input.record],
    }),
  });
}

const SET_TEXT_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
  },
] as const;

/** Metadata records — same text keys as v1 (class, name, description, url). */
async function writeOrgMetadataRecordsV2(input: {
  from: Address;
  orgName: string;
  displayName: string;
}): Promise<Hex | null> {
  const client = createSoulVaultPublicClient(getBrowserSoulVaultClientConfig()!);
  const { getEnsResolver } = await import("viem/ens");
  const resolver = await client
    .getEnsResolver({ name: input.orgName })
    .catch(() => null);
  if (!resolver || resolver === zeroAddress) return null;
  const node = labelhash(normalize(input.orgName));
  let lastHash: Hex | null = null;
  const records: Array<[string, string]> = [
    ["class", ORG_ENS_CLASS_VALUE],
    ["name", input.displayName],
    ["url", `https://${input.orgName}`],
  ];
  for (const [key, value] of records) {
    lastHash = await sendWalletTransaction({
      from: input.from,
      to: resolver,
      data: encodeFunctionData({
        abi: SET_TEXT_ABI,
        functionName: "setText",
        args: [node, key, value],
      }),
    });
  }
  return lastHash;
}

const ORG_ENS_CLASS_VALUE = "soulvault.organization";
