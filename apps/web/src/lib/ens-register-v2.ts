// ENSv2 org registration (docs/ensv2-integration-spec.md §4) — browser port of
// packages/node/src/ensv2-registry.ts. Structurally different from the v1
// commit/reveal flow (ens-register.ts): no controller, no commitment wait, no
// unwrap. Steps = deploy org registry via the VerifiableFactory → register the
// name in it with epoch-bound expiry → deploy + attach a PermissionedResolver
// (setResolver) → mirror the registry address on the org name's resolver →
// metadata records.
//
// Protocol detection (backwards compat): the v2 registry address is mirrored
// under the `soulvault.ensv2Registry` text record on the org name. Presence ⇒
// v2, absence ⇒ v1 — orgs built on the legacy controller keep using the v1
// wizard untouched.
//
// Idempotency: CREATE2 salts are label-derived, so a re-run from the same
// wallet would collide at deployProxy. Before deploying we read the label's
// state from the previously deployed registry (address recomputed onchain via
// the factory's proxyLogic() + CREATE2 — no local artifacts) and skip
// deploy/register when the name is already registered and unexpired.
import {
  concatHex,
  encodeFunctionData,
  getCreate2Address,
  getAddress,
  keccak256,
  labelhash,
  namehash,
  pad,
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
  // PermissionedResolver implementation (deployments/sepolia/PermissionedResolverImpl.json).
  permissionedResolverImpl: "0x7e4b2d59938930168024201752ee5503df402303",
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

const RESOLVER_INITIALIZE_ABI = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "setters", type: "bytes[]" },
    ],
  },
] as const;

/** VerifiableFactory view helpers — CREATE2 precompute + proxy verification. */
const FACTORY_VIEW_ABI = [
  {
    type: "function",
    name: "proxyLogic",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "verifyContract",
    stateMutability: "view",
    inputs: [{ name: "proxy", type: "address" }],
    outputs: [{ name: "implementation", type: "address" }],
  },
] as const;

/** getState on the org registry — label registration status + resolver slot. */
const REGISTRY_STATE_ABI = [
  {
    type: "function",
    name: "getState",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [
      {
        name: "state",
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "expiry", type: "uint64" },
          { name: "latestOwner", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "resource", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
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

/** Deterministic resolver-proxy salt per org label (distinct from the registry salt). */
export function orgResolverSalt(label: string): bigint {
  return BigInt(keccak256(toHexBytes(`${label}-resolver`)));
}

function toHexBytes(s: string): Hex {
  return `0x${Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as Hex;
}

/**
 * Recompute the VerifiableFactory's CREATE2 proxy address for (deployer, salt,
 * initData) — byte-exact port of CloneProxyBytecode.creationCode. The proxy is
 * a 77-byte EIP-1167-style clone: 45-byte runtime with the shared proxyLogic
 * address in the PUSH20 slot, plus the 32-byte outerSalt appended for the
 * factory's verifyContract(). The factory derives the outer salt as
 * keccak256(abi.encode(msg.sender, salt)) so the same user salt from a
 * different wallet never collides.
 */
export function computeVerifiableProxyAddress(input: {
  factory: Address;
  proxyLogic: Address;
  deployer: Address;
  salt: bigint;
}): Address {
  // NOTE: slice(10) strips the selector but ALSO leaves no `0x` prefix — viem's
  // keccak256 then hashes the wrong bytes (treats the bare hex string as
  // non-hex), producing a wrong outerSalt and thus a wrong predicted address.
  // Without the correct address the step-1 idempotency probe reads a
  // non-registry contract and the re-run tries to deploy again → CREATE2
  // collision at the REAL address → factory reverts with empty data.
  const outerSalt = keccak256(
    ("0x" +
      encodeFunctionData({
        abi: [{ type: "function", name: "__abiEncodeOnly", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }],
        functionName: "__abiEncodeOnly",
        args: [input.deployer, input.salt],
      }).slice(10)) as Hex,
  );
  const creationCode = concatHex([
    "0x3d604d80600a3d3981f3363d3d373d3d3d363d73" as Hex, // creation stub + runtime prefix (20B)
    pad(input.proxyLogic, { size: 20 }), // PUSH20 proxyLogic
    "0x5af43d82803e903d91602b57fd5bf3" as Hex, // runtime suffix (15B)
    pad(outerSalt, { size: 32 }), // appended salt for verifyContract()
  ]);
  return getCreate2Address({
    from: input.factory,
    salt: outerSalt,
    bytecodeHash: keccak256(creationCode),
  });
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

export async function detectOrgEnsVersion(
  orgName: string,
  viewer?: Address,
): Promise<OrgEnsVersion> {
  const record = await readEnsV2RegistryRecord(orgName).catch(() => null);
  if (record) return "v2";
  // The pointer record is written to the org's PermissionedResolver, which the
  // v1-registry-walking viem ENS client can never discover for a fresh v2 name
  // (no v1 owner). Fall back to the deterministic CREATE2 probe from the
  // viewer's wallet — same math the registration wizard uses for idempotency.
  if (viewer && (await resolveEnsV2OrgRecord({ orgName, viewer }))) return "v2";
  return "v1";
}

export type ResolvedEnsV2OrgRecord = {
  registry: Address;
  resolver: Address;
  owner: Address;
  expiry: bigint;
};

/**
 * Locate a v2 org's registry + attached PermissionedResolver without relying on
 * v1-registry discovery (impossible for fresh v2 names — the v1 registry has no
 * owner for them, so viem's ENS helpers return 0x0). Two probes, in order:
 *   1. The `soulvault.ensv2Registry` pointer record — authoritative when the
 *      name resolves v1-side (orgs with a mixed/legacy setup).
 *   2. The viewer's deterministic CREATE2 registry address (salts bind the
 *      deployer, so this only answers for the owner's own wallet) — works with
 *      zero prior knowledge of local artifacts.
 * Returns null when no v2 org can be proven for this name/viewer.
 */
export async function resolveEnsV2OrgRecord(input: {
  orgName: string;
  viewer?: Address;
}): Promise<ResolvedEnsV2OrgRecord | null> {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) return null;
  const client = createSoulVaultPublicClient(config);

  const probeRegistry = async (registry: Address, label: string): Promise<ResolvedEnsV2OrgRecord | null> => {
    try {
      const labelStateId = BigInt(labelhash(label));
      const state = await readLabelState(client, registry, labelStateId);
      if (state.status !== 2) return null;
      const resolver = await readRegistryResolver(client, registry, label);
      if (!resolver) return null;
      return { registry, resolver, owner: state.latestOwner, expiry: state.expiry };
    } catch {
      return null;
    }
  };

  const pointer = await readEnsV2RegistryRecord(input.orgName).catch(() => null);
  if (pointer) {
    const { label } = parseEnsV2OrgLabel(input.orgName);
    const viaPointer = await probeRegistry(pointer.registry, label);
    if (viaPointer) return viaPointer;
  }

  if (!input.viewer) return null;
  const { label } = parseEnsV2OrgLabel(input.orgName);
  try {
    const shared = getEnsV2SharedAddresses();
    const expectedRegistry = computeVerifiableProxyAddress({
      factory: getAddress(shared.verifiableFactory),
      proxyLogic: await readFactoryProxyLogic(client, shared.verifiableFactory as Address),
      deployer: getAddress(input.viewer),
      salt: orgRegistrySalt(label),
    });
    const code = await client.getBytecode({ address: expectedRegistry }).catch(() => null);
    if (!code || code === "0x") return null;
    return await probeRegistry(expectedRegistry, label);
  } catch {
    return null;
  }
}

// --- Registration flow (one wallet prompt per step).

export type EnsV2RegisterStepId = "deploy" | "register" | "resolver" | "mirror" | "metadata";

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
  //
  // Idempotent re-run: salts are label-derived, so deploying twice from the
  // same wallet would CREATE2-collide. When the label is already registered and
  // unexpired in the previously deployed registry, skip deploy + register and
  // resume at resolver-attach / mirror (the partial-state repair path).
  input.onStep?.("deploy", { status: "active" });
  const client = createSoulVaultPublicClient(getBrowserSoulVaultClientConfig()!);
  const labelStateId = BigInt(labelhash(label));
  let registryAddress: Address | null = null;
  let existingState: { status: number; expiry: bigint; latestOwner: Address; resolver?: never } | null =
    null;

  // Recompute the previously deployed registry address from CREATE2 math —
  // works for any prior run of the same wallet, no local artifacts needed.
  const expectedRegistry = computeVerifiableProxyAddress({
    factory: getAddress(shared.verifiableFactory),
    proxyLogic: await readFactoryProxyLogic(client, shared.verifiableFactory as Address),
    deployer: owner,
    salt: orgRegistrySalt(label),
  });
  const existing = await client
    .readContract({
      address: expectedRegistry,
      abi: ENSV2_USER_REGISTRY_ABI,
      functionName: "hasRoles",
      args: [0n, ENSV2_ROLES.ROLE_REGISTRAR, owner],
    })
    .catch(() => null);
  if (existing) {
    // A registry exists at the deterministic address (initialized by this owner)
    // — never re-deploy, or the label-derived CREATE2 salt collides and the
    // factory reverts. Check the label state to decide whether register() is
    // also already done.
    registryAddress = expectedRegistry;
    const state = await readLabelState(client, expectedRegistry, labelStateId);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (state.status === 2 && state.expiry > nowSec) {
      // Already registered + unexpired → skip deploy + register.
      existingState = { status: state.status, expiry: state.expiry, latestOwner: state.latestOwner };
      input.onStep?.("deploy", { status: "done", detail: registryAddress });
      input.onStep?.("register", { status: "done", detail: "already registered" });
    } else {
      // Partial prior run: registry deployed but label not (yet) registered
      // (or expired) → resume at register without redeploying.
      input.onStep?.("deploy", {
        status: "done",
        detail: `${registryAddress} (already deployed — recovered)`,
      });
    }
  }

  if (!registryAddress) {
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
    registryAddress = deployReceipt.contractAddress
      ? getAddress(deployReceipt.contractAddress)
      : await resolveProxyAddressFromLogs(deployHash);
    if (!registryAddress) {
      throw new Error(
        `deployProxy succeeded but the proxy address could not be parsed (tx ${deployHash}).`,
      );
    }
    txHashes.deploy = deployHash;
    input.onStep?.("deploy", { status: "done", detail: registryAddress });
  }

  // Post-deploy verification — same trust rule as the node package: only trust
  // the registry if it really granted the owner ROLE_REGISTRAR on root.
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
  if (!existingState) {
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
  }
  const expiry = existingState ? existingState.expiry : expiryFromNow(epochSeconds);

  // Step 2.5 — deploy + attach a PermissionedResolver for the org name.
  // Without a resolver slot the name is unresolvable (UI shows Resolver 0x0)
  // and no text records can ever be written — this was the gap that left
  // freshly registered v2 names dead in the water. Deterministic salt ⇒ a
  // re-run converges on the same resolver address; if the registry's resolver
  // slot is already set we skip both txs.
  input.onStep?.("resolver", { status: "active" });
  const labelState = await readLabelState(client, registryAddress, labelStateId);
  let resolverAddress = labelState.latestOwner === zeroAddress ? null : await readRegistryResolver(client, registryAddress, label);
  if (!resolverAddress) {
    const proxyLogic = await readFactoryProxyLogic(client, shared.verifiableFactory as Address);
    const expectedResolver = computeVerifiableProxyAddress({
      factory: getAddress(shared.verifiableFactory),
      proxyLogic,
      deployer: owner,
      salt: orgResolverSalt(label),
    });
    const resolverCode = await client.getBytecode({ address: expectedResolver }).catch(() => null);
    if (resolverCode && resolverCode !== "0x") {
      // Resolver proxy already exists from a prior partial run — just attach it.
      resolverAddress = expectedResolver;
    } else {
      const resolverInitData = encodeFunctionData({
        abi: RESOLVER_INITIALIZE_ABI,
        functionName: "initialize",
        args: [owner, EAC_ALL_ROLES, []],
      });
      const resolverDeployHash = await sendWalletTransaction({
        from: owner,
        to: shared.verifiableFactory as Address,
        data: encodeFunctionData({
          abi: ENSV2_VERIFIABLE_FACTORY_ABI,
          functionName: "deployProxy",
          args: [shared.permissionedResolverImpl as Address, orgResolverSalt(label), resolverInitData],
        }),
      });
      const resolverReceipt = await waitForWalletReceipt(resolverDeployHash);
      if (resolverReceipt.status !== "success") {
        throw new Error(`Resolver deploy reverted (tx ${resolverDeployHash}).`);
      }
      resolverAddress =
        resolverReceipt.contractAddress
          ? getAddress(resolverReceipt.contractAddress)
          : await resolveProxyAddressFromLogs(resolverDeployHash);
      if (!resolverAddress) {
        throw new Error(
          `Resolver deployProxy succeeded but the proxy address could not be parsed (tx ${resolverDeployHash}).`,
        );
      }
      txHashes.resolver = resolverDeployHash;
    }
    // Attach: setResolver on the name's token (owner holds ROLE_SET_RESOLVER
    // via ORG_NAME_ROLES granted at register()).
    const setResolverHash = await sendWalletTransaction({
      from: owner,
      to: registryAddress,
      data: encodeFunctionData({
        abi: REGISTRY_STATE_ABI,
        functionName: "setResolver",
        args: [labelStateId, resolverAddress],
      }),
    });
    const setResolverReceipt = await waitForWalletReceipt(setResolverHash);
    if (setResolverReceipt.status !== "success") {
      throw new Error(`setResolver reverted (tx ${setResolverHash}).`);
    }
    txHashes.resolver = txHashes.resolver ?? setResolverHash;
    input.onStep?.("resolver", { status: "done", detail: resolverAddress });
  } else {
    input.onStep?.("resolver", { status: "done", detail: `${resolverAddress} (already attached)` });
  }

  // Step 3 — mirror the registry address on the org name's resolver so any
  // reader (and this wizard's auto-detect) can discover the v2 protocol.
  // Written DIRECTLY to the org's resolver: viem's getEnsResolver walks the v1
  // registry, where a fresh v2 name has no owner (0x0) — it can never find the
  // resolver we just attached.
  input.onStep?.("mirror", { status: "active" });
  // Idempotent skip: the record embeds a `deployedAt` timestamp that changes
  // every run, so exact-value comparison would never fire. A valid pointer
  // (same registry + owner, any timestamp) proves the mirror already happened.
  const currentPointer = (await readResolverText(resolverAddress!, namehash(normalized), ENSV2_REGISTRY_TEXT_KEY).catch(() => null)) as string | null;
  const existingPointer = currentPointer ? decodeEnsV2RegistryRecord(currentPointer) : null;
  const mirrorDone = !!existingPointer && existingPointer.registry === registryAddress && existingPointer.owner === owner;
  let mirrorHash: Hex | null = null;
  if (!mirrorDone) {
    mirrorHash = await writeEnsV2RegistryPointer({
      from: owner,
      orgName: normalized,
      orgNode: namehash(normalized),
      resolver: resolverAddress!,
      record: encodeEnsV2RegistryRecord({
        registry: registryAddress,
        owner,
        // On overwrite repair, keep the original deployment time when known.
        deployedAt: existingPointer?.deployedAt ?? new Date().toISOString(),
      }),
    });
  }
  if (mirrorHash) {
    const mirrorReceipt = await waitForWalletReceipt(mirrorHash);
    if (mirrorReceipt.status !== "success") {
      throw new Error(`Registry pointer write reverted (tx ${mirrorHash}).`);
    }
    txHashes.mirror = mirrorHash;
    input.onStep?.("mirror", { status: "done" });
  } else {
    input.onStep?.("mirror", { status: "done", detail: "already written" });
  }

  // Step 4 — metadata records (same keys as the v1 wizard + CLI).
  input.onStep?.("metadata", { status: "active" });
  const metadataHash = await writeOrgMetadataRecordsV2({
    from: owner,
    orgName: normalized,
    orgNode: namehash(normalized),
    resolver: resolverAddress!,
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
 * Read the org registry's proxyLogic() — needed for the CREATE2 precompute.
 */
async function readFactoryProxyLogic(
  client: ReturnType<typeof createSoulVaultPublicClient>,
  factory: Address,
): Promise<Address> {
  const logic = (await client.readContract({
    address: factory,
    abi: FACTORY_VIEW_ABI,
    functionName: "proxyLogic",
  })) as Address;
  return getAddress(logic);
}

type LabelState = { status: number; expiry: bigint; latestOwner: Address };

/**
 * getState returns a named tuple; this viem version decodes named tuple outputs
 * to objects (not arrays), so numeric indexing silently yields undefined and
 * the idempotency probe would re-deploy an already-deployed registry (CREATE2
 * collision). Normalize both shapes here.
 */
async function readLabelState(
  client: ReturnType<typeof createSoulVaultPublicClient>,
  registry: Address,
  labelStateId: bigint,
): Promise<LabelState> {
  const state = (await client.readContract({
    address: registry,
    abi: REGISTRY_STATE_ABI,
    functionName: "getState",
    args: [labelStateId],
  })) as unknown as {
    status: number;
    expiry: bigint;
    latestOwner: Address;
    tokenId: bigint;
    resource: bigint;
  };
  const parts = (
    Array.isArray(state)
      ? state
      : [state.status, state.expiry, state.latestOwner, state.tokenId, state.resource]
  ) as unknown as readonly [number, bigint, Address, bigint, bigint];
  return {
    status: Number(parts[0]),
    expiry: BigInt(parts[1]),
    latestOwner: getAddress(parts[2]),
  };
}

/**
 * Read the resolver slot for `label` from the registry (getResolver(label)).
 */
async function readRegistryResolver(
  client: ReturnType<typeof createSoulVaultPublicClient>,
  registry: Address,
  label: string,
): Promise<Address | null> {
  const resolver = (await client
    .readContract({
      address: registry,
      abi: [
        {
          type: "function",
          name: "getResolver",
          stateMutability: "view",
          inputs: [{ name: "label", type: "string" }],
          outputs: [{ name: "", type: "address" }],
        },
      ] as const,
      functionName: "getResolver",
      args: [label],
    })
    .catch(() => null)) as Address | null;
  if (!resolver || resolver === zeroAddress) return null;
  return getAddress(resolver);
}

/**
 * Write the `soulvault.ensv2Registry` pointer on the org name's resolver.
 * Takes the resolver address explicitly — viem's getEnsResolver walks the v1
 * registry where fresh v2 names have no owner, so discovery there is
 * impossible by construction.
 */
async function writeEnsV2RegistryPointer(input: {
  from: Address;
  orgName: string;
  orgNode: Hex;
  resolver: Address;
  record: string;
}): Promise<Hex | null> {
  return sendWalletTransaction({
    from: input.from,
    to: input.resolver,
    data: encodeFunctionData({
      abi: SET_TEXT_ABI,
      functionName: "setText",
      args: [input.orgNode, ENSV2_REGISTRY_TEXT_KEY, input.record],
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

/** Resolver batching — same multicall(bytes[]) shape as ENS PublicResolver. */
const MULTICALL_ABI = [
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "", type: "bytes[]" }],
  },
] as const;

/** Metadata records — same text keys as v1 (class, name, url). */
async function writeOrgMetadataRecordsV2(input: {
  from: Address;
  orgName: string;
  orgNode: Hex;
  resolver: Address;
  displayName: string;
}): Promise<Hex | null> {
  const node = input.orgNode;
  const records: Array<[string, string]> = [
    ["class", ORG_ENS_CLASS_VALUE],
    ["name", input.displayName],
    ["url", `https://${input.orgName}`],
  ];
  const changed: Array<[string, string]> = [];
  for (const [key, value] of records) {
    // Idempotent skip: only send records whose value differs on-chain.
    const current = (await readResolverText(input.resolver, node, key).catch(() => null)) as string | null;
    if (current !== value) changed.push([key, value]);
  }
  if (changed.length === 0) {
    return null;
  }
  const calldatas = changed.map(([key, value]) =>
    encodeFunctionData({
      abi: SET_TEXT_ABI,
      functionName: "setText",
      args: [node, key, value],
    }),
  );
  // All changed records ride a single multicall(bytes[]) tx (msg.sender
  // semantics preserved — the owner's setter roles apply to every inner call).
  return sendWalletTransaction({
    from: input.from,
    to: input.resolver,
    data: encodeFunctionData({
      abi: MULTICALL_ABI,
      functionName: "multicall",
      args: [calldatas],
    }),
  });
}

async function readResolverText(resolver: Address, node: Hex, key: string): Promise<string | null> {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) return null;
  const client = createSoulVaultPublicClient(config);
  const value = (await client.readContract({
    address: resolver,
    abi: [
      {
        type: "function",
        name: "text",
        stateMutability: "view",
        inputs: [
          { name: "node", type: "bytes32" },
          { name: "key", type: "string" },
        ],
        outputs: [{ name: "", type: "string" }],
      },
    ] as const,
    functionName: "text",
    args: [node, key],
  })) as string;
  return value || null;
}

const ORG_ENS_CLASS_VALUE = "soulvault.organization";
