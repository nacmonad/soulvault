// ---------------------------------------------------------------------------
// ENSv2 (Sepolia beta) client
// ---------------------------------------------------------------------------
//
// ENSv2 replaces the flat ENSv1 registry with a hierarchy of per-name registries
// (subname registries), tokenized names (ERC-1155), and Enhanced Access Control
// (EAC) instead of raw ownership checks. Beta deployment on Sepolia; contract
// ABIs pinned to ensdomains/contracts-v2 @ 97a5729.
//
// This module is deliberately read-first and dependency-free: Phase 1 dispatches
// reads through here and keeps writes on v1 (except gated text/addr writes that
// target the v2 resolver directly). Phase 2+ adds registration and EAC grants.

import { Contract, JsonRpcProvider } from 'ethers';
import { namehash, labelhash as viemLabelhash } from 'viem/ens';
import { loadEnv } from './config.js';
import { createEnsProvider, createEnsSigner } from './ens.js';

/**
 * ENSv2 Sepolia beta addresses (docs.ens.domains/learn/deployments, Sepolia section).
 * Env vars override; these are the pinned defaults matching ABI commit 97a5729.
 */
export const ENSV2_SEPOLIA_ADDRESSES = {
  rootRegistry: '0x8115186e8f2e0b0281e86ab91f0f48ba90364354',
  universalResolver: '0x4a1817d13e9cf196f471725176355c1234b63c70',
  verifiableFactory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef',
  userRegistryImpl: '0x624a25d67b59d587752ebec8dded8827dae52050',
  ethRegistry: '0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2',
  ethRegistrar: '0xa88553f454b77203b0d036a05c894d555eaaa2cc',
  ensv2Resolver: '0x508cb4e4596429ca98a1bb3112d88d18f92456b5',
} as const;

/** True when SOULVAULT_ENSV2=1 AND the required v2 addresses are configured. */
export function isEnsV2Enabled(): boolean {
  const env = loadEnv();
  if (!env.SOULVAULT_ENSV2) return false;
  if (!env.SOULVAULT_ENSV2_ROOT_REGISTRY_ADDRESS) return false;
  return true;
}

/** Resolved v2 addresses (env override → pinned Sepolia beta defaults). */
export function getEnsV2Addresses() {
  const env = loadEnv();
  return {
    rootRegistry: env.SOULVAULT_ENSV2_ROOT_REGISTRY_ADDRESS ?? ENSV2_SEPOLIA_ADDRESSES.rootRegistry,
    universalResolver:
      env.SOULVAULT_ENSV2_UNIVERSAL_RESOLVER_ADDRESS ?? ENSV2_SEPOLIA_ADDRESSES.universalResolver,
  };
}

// --- ABIs (pinned @ contracts-v2 97a5729) -----------------------------------

/** IRegistry — label-string navigation (NOT labelhash — v2 API change from v1). */
export const ENSV2_REGISTRY_ABI = [
  'function getSubregistry(string label) view returns (address)',
  'function getResolver(string label) view returns (address)',
  'function getParent() view returns (address parent, string label)',
] as const;

/** IPermissionedRegistry — tokenized names + expiry + EAC resources. */
export const ENSV2_PERMISSIONED_REGISTRY_ABI = [
  'function latestOwnerOf(uint256 tokenId) view returns (address)',
  'function getState(uint256 anyId) view returns (tuple(uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
  'function getStatus(uint256 anyId) view returns (uint8)',
  'function getTokenId(uint256 anyId) view returns (uint256)',
  // EAC surface lives directly on the PermissionedRegistry:
  'function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)',
  'function roles(uint256 resource, address account) view returns (uint256)',
] as const;

/** ENSv2 resolver — record interface is unchanged from v1 (setText/text/addr). */
export const ENSV2_RESOLVER_ABI = [
  'function text(bytes32 node, string key) view returns (string)',
  'function addr(bytes32 node, uint256 coinType) view returns (bytes)',
  'function setAddr(bytes32 node, uint256 coinType, bytes a)',
] as const;

// --- Role constants (RegistryRolesLib — nybble-packed bitmaps) --------------

export const ENSV2_ROLES = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_REGISTER_RESERVED: 1n << 4n,
  ROLE_SET_PARENT: 1n << 8n,
  ROLE_UNREGISTER: 1n << 12n,
  ROLE_RENEW: 1n << 16n,
  ROLE_SET_SUBREGISTRY: 1n << 20n,
  ROLE_SET_RESOLVER: 1n << 24n,
} as const;

// --- Contract accessors -----------------------------------------------------

export async function getEnsV2Provider(): Promise<JsonRpcProvider> {
  return createEnsProvider();
}

export async function getEnsV2Registry(withSigner = false) {
  const runner = withSigner ? await createEnsSigner() : await getEnsV2Provider();
  return new Contract(getEnsV2Addresses().rootRegistry, ENSV2_REGISTRY_ABI, runner);
}

export async function getEnsV2UniversalResolver(withSigner = false) {
  const runner = withSigner ? await createEnsSigner() : await getEnsV2Provider();
  return new Contract(getEnsV2Addresses().universalResolver, ENSV2_RESOLVER_ABI, runner);
}

// --- Name walking -----------------------------------------------------------

/** Split an ENS name into labels, TLD-last. `ops.foo.eth` → ['ops', 'foo', 'eth']. */
export function splitEnsLabels(name: string): string[] {
  return name.split('.').filter(Boolean);
}

/**
 * Walk the v2 registry hierarchy for a name: root registry → getSubregistry(label)
 * per label. Returns the deepest registry reached plus the remaining unregistered
 * labels (empty when the full name is registered).
 */
export async function walkEnsV2Registry(fullName: string): Promise<{
  registryAddress: string;
  resolvedLabels: string[];
  unresolvedLabels: string[];
}> {
  // The hierarchy is rooted at the TLD: RootRegistry holds `eth`, the ETHRegistry
  // holds 2LDs, and so on down. Names are written TLD-last (`ops.foo.eth`), so the
  // walk order is the labels REVERSED (eth → foo → ops).
  const labels = splitEnsLabels(fullName).reverse();
  let registryAddress = getEnsV2Addresses().rootRegistry;
  const resolved: string[] = [];
  for (const label of labels) {
    const registry = new Contract(registryAddress, ENSV2_REGISTRY_ABI, await getEnsV2Provider());
    const next = await registry.getSubregistry(label);
    const nextAddr = String(next);
    if (!nextAddr || nextAddr === '0x0000000000000000000000000000000000000000') {
      return { registryAddress, resolvedLabels: resolved, unresolvedLabels: [...resolved.slice().reverse(), label] };
    }
    registryAddress = nextAddr;
    resolved.push(label);
  }
  return { registryAddress, resolvedLabels: resolved.reverse(), unresolvedLabels: [] };
}

/**
 * Resolve the resolver contract address for a fully-qualified v2 name by walking
 * the hierarchy and calling getResolver at the deepest registered parent.
 * Returns null when the name has no resolver configured.
 */
export async function getEnsV2ResolverAddress(fullName: string): Promise<string | null> {
  const labels = splitEnsLabels(fullName);
  if (labels.length === 0) return null;
  // Walk to the deepest registered registry, checking each level's resolver.
  // ENSv2 resolvers are attached per-label: a name's resolver is the resolver of
  // its deepest registered label.
  const { registryAddress, resolvedLabels } = await walkEnsV2Registry(fullName);
  if (resolvedLabels.length === 0) return null;
  const deepest = resolvedLabels[resolvedLabels.length - 1];
  const registry = new Contract(registryAddress, ENSV2_REGISTRY_ABI, await getEnsV2Provider());
  const resolver = await registry.getResolver(deepest);
  const resolverStr = String(resolver);
  if (!resolverStr || resolverStr === '0x0000000000000000000000000000000000000000') return null;
  return resolverStr;
}

// --- Owner / state ----------------------------------------------------------

/** Status enum from IPermissionedRegistry: 0=AVAILABLE, 1=RESERVED, 2=REGISTERED. */
export const ENSV2_STATUS = { AVAILABLE: 0, RESERVED: 1, REGISTERED: 2 } as const;

/**
 * Read name ownership via the v2 tokenized registry. Walks the hierarchy to find
 * the permissioned registry holding the name, then reads getState(labelhash).
 * Returns null when the name is unregistered/available — callers decide how to
 * handle that (v1 readEnsNodeOwner returns a zero address in the same case).
 */
export async function readEnsV2NameState(fullName: string): Promise<{
  status: number;
  expiry: number;
  latestOwner: string;
  tokenId: bigint;
  resource: bigint;
  registryAddress: string;
} | null> {
  const labels = splitEnsLabels(fullName);
  if (labels.length === 0) return null;
  // The name's own registry is the deepest one reached by the walk; its label is
  // the first (leftmost) label of the full name.
  const label = labels[0];
  const { registryAddress, resolvedLabels } = await walkEnsV2Registry(fullName);
  if (resolvedLabels.length < labels.length) return null; // not fully registered
  const registry = new Contract(
    registryAddress,
    [...ENSV2_REGISTRY_ABI, ...ENSV2_PERMISSIONED_REGISTRY_ABI],
    await getEnsV2Provider(),
  );
  const state = await registry.getState(BigInt(viemLabelhash(label)));
  const [status, expiry, latestOwner, tokenId, resource] = state as [number, bigint, string, bigint, bigint];
  if (Number(status) === ENSV2_STATUS.AVAILABLE) return null;
  return {
    status: Number(status),
    expiry: Number(expiry),
    latestOwner: String(latestOwner),
    tokenId,
    resource,
    registryAddress,
  };
}

/**
 * EAC role check: does `account` hold all the roles in `roleBitmap` on the
 * resource for `fullName`? The resource ID for a name is its token ID in the
 * permissioned registry (see IPermissionedRegistry.TokenResource event).
 */
export async function hasEnsV2Roles(fullName: string, roleBitmap: bigint, account: string): Promise<boolean> {
  const state = await readEnsV2NameState(fullName);
  if (!state) return false;
  const registry = new Contract(
    state.registryAddress,
    ENSV2_PERMISSIONED_REGISTRY_ABI,
    await getEnsV2Provider(),
  );
  return Boolean(await registry.hasRoles(state.resource, roleBitmap, account));
}

/** Actionable-error wrapper: checks EAC roles before a write and throws a fix-it message. */
export async function requireEnsV2Roles(
  fullName: string,
  roleBitmap: bigint,
  account: string,
  action: string,
): Promise<void> {
  const ok = await hasEnsV2Roles(fullName, roleBitmap, account);
  if (!ok) {
    throw new Error(
      `Wallet ${account} lacks the required EAC role(s) (bitmap ${roleBitmap}) on "${fullName}" ` +
        `for: ${action}. Grant them via the ENSv2 EAC (grantRoles on resource ${fullName}) before retrying.`,
    );
  }
}

// Re-export namehash for dispatch code convenience.
export { namehash };
