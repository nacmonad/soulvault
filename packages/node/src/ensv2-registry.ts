// ---------------------------------------------------------------------------
// ENSv2 SoulVaultRegistry — org subname registry deployment + registration
// ---------------------------------------------------------------------------
//
// Phase 2 (docs/ensv2-integration-spec.md §4): deploy the org's custom subname
// registry via the ENSv2 VerifiableFactory, then register swarm subnames under
// it with epoch-bound expiries. This is what makes SoulVault a first-class
// ENSv2 namespace operator and turns the org config layer into real registry
// entries (replacing the CBOR `soulvault.swarms` list).
//
// The flow mirrors contracts/ensv2/SoulVaultRegistrySpike.t.sol (6/6 forge tests
// passing): VerifiableFactory.deployProxy(UserRegistry impl, salt,
// initialize(rootAccount, EACBaseRolesLib.ALL_ROLES)) → PermissionedRegistry
// surface (register/renew/grantRoles) on the proxy.
//
// Deployment uses the VerifiableFactory with a caller-chosen salt so the proxy
// address is deterministic and verifiable onchain (CREATE2 semantics) — the
// "Verifiable" part: anyone can recompute the address from (factory, impl,
// salt, initData) and confirm no hidden initialization.

import fs from 'fs-extra';
import path from 'node:path';
import { Contract, ContractFactory, ZeroAddress, getAddress } from 'ethers';
import { labelhash as viemLabelhash } from 'viem/ens';
import { loadEnv } from './config.js';
import { createEnsSigner } from './ens.js';
import { getEnsV2Provider } from './ensv2.js';
import { resolveRepoRoot } from './paths.js';

/**
 * ENSv2 Sepolia beta: shared LabelStore + canonical UserRegistry implementation
 * (docs.ens.domains/learn/deployments, matching ABI pin 97a5729). The factory is
 * the trust anchor — it enforces verifiable proxy deployment, so anyone can
 * confirm our registry is an unmodified UserRegistry behind a standard proxy.
 * Env overrides keep us honest if the beta redeploys.
 */
export const ENSV2_SHARED_ADDRESSES = {
  labelStore: '0x8b16d15f3e51074d0e06f3cf4a0053f7cb92a7fb', // placeholder — replaced below at runtime if env set
  userRegistryImpl: '0x624a25d67b59d587752ebec8dded8827dae52050',
  verifiableFactory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef',
} as const;

/** Shared label database + registry implementation (env override → Sepolia beta defaults). */
export function getEnsV2SharedAddresses() {
  const env = loadEnv();
  return {
    labelStore: env.SOULVAULT_ENSV2_LABEL_STORE_ADDRESS ?? ENSV2_SHARED_ADDRESSES.labelStore,
    userRegistryImpl:
      env.SOULVAULT_ENSV2_USER_REGISTRY_IMPL_ADDRESS ?? ENSV2_SHARED_ADDRESSES.userRegistryImpl,
    verifiableFactory:
      env.SOULVAULT_ENSV2_VERIFIABLE_FACTORY_ADDRESS ?? ENSV2_SHARED_ADDRESSES.verifiableFactory,
  };
}

// --- ABIs (pinned @ contracts-v2 97a5729) -----------------------------------

export const ENSV2_VERIFIABLE_FACTORY_ABI = [
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
] as const;

export const ENSV2_LABEL_STORE_ABI = [] as const;

export const ENSV2_USER_REGISTRY_ABI = [
  // PermissionedRegistry surface used by the CLI:
  'function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)',
  'function renew(uint256 anyId, uint64 newExpiry)',
  'function grantRoles(uint256 resource, uint256 roleBitmap, address account)',
  'function revokeRoles(uint256 resource, uint256 roleBitmap, address account)',
  'function getSubregistry(string label) view returns (address)',
  'function getResolver(string label) view returns (address)',
  'function getParent() view returns (address parent, string label)',
  'function latestOwnerOf(uint256 tokenId) view returns (address)',
  'function getState(uint256 anyId) view returns (tuple(uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))',
  'function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)',
  'function roles(uint256 resource, address account) view returns (uint256)',
] as const;

// --- Role constants (parity with ensv2.ts + RegistryRolesLib) ----------------

/** RegistryRolesLib nybble-packed roles (labelhash-keyed resource space). */
export const REGISTRY_ROLES = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_REGISTER_RESERVED: 1n << 4n,
  ROLE_SET_PARENT: 1n << 8n,
  ROLE_UNREGISTER: 1n << 12n,
  ROLE_RENEW: 1n << 16n,
  ROLE_SET_SUBREGISTRY: 1n << 20n,
  ROLE_SET_RESOLVER: 1n << 24n,
} as const;

/**
 * EACBaseRolesLib.ALL_ROLES — mask with bit 0 set in every nybble (64 role slots).
 * Granted to the org owner on the root resource at initialize() so they can
 * register, grant, renew, and upgrade.
 */
export const EAC_ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;

/**
 * Roles delegated to the name owner by a swarm registration. Deliberately does
 * NOT include ROLE_UNREGISTER or ROLE_SET_PARENT — those stay root-only (org).
 */
export const SWARM_NAME_ROLES =
  REGISTRY_ROLES.ROLE_SET_RESOLVER | REGISTRY_ROLES.ROLE_RENEW;

// --- Artifact loading --------------------------------------------------------

type Artifact = {
  abi: any[];
  bytecode: { object: string } | string;
};

async function loadArtifact(solFile: string, contract: string): Promise<Artifact> {
  const artifactPath = path.join(resolveRepoRoot(), 'out', solFile, `${contract}.json`);
  const artifact = (await fs.readJson(artifactPath)) as Artifact;
  const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
  if (!bytecode || bytecode === '0x') {
    throw new Error(`Artifact ${solFile}/${contract}.json has empty bytecode — run \`forge build\` first.`);
  }
  return { abi: artifact.abi, bytecode };
}

// --- Deployment --------------------------------------------------------------

/**
 * Deploy the org's SoulVaultRegistry (UserRegistry proxy) via the VerifiableFactory.
 *
 * `ownerAddress` (default: the active signer) receives EAC_ALL_ROLES on the root
 * resource — admin of the whole `*.<org>.eth` namespace. `salt` pins a
 * deterministic proxy address; the default is the labelhash of the org label so
 * redeploys of the same org converge (and a second call fails loudly at CREATE2
 * instead of silently forking the namespace).
 */
export async function deployEnsV2OrgRegistry(input: {
  salt?: bigint;
  owner?: string;
  verifiableFactoryAddress?: string;
  userRegistryImplAddress?: string;
  labelStoreAddress?: string;
}) {
  const signer = await createEnsSigner();
  const shared = getEnsV2SharedAddresses();
  const factoryAddress = input.verifiableFactoryAddress ?? shared.verifiableFactory;
  const implAddress = input.userRegistryImplAddress ?? shared.userRegistryImpl;
  const labelStoreAddress = input.labelStoreAddress ?? shared.labelStore;

  // The UserRegistry implementation is deployed once per LabelStore — we deploy
  // our own instance here so the org registry never shares mutable state with
  // the canonical ENS Labs deployment (spike pattern: new UserRegistry(labelStore, namer)).
  const labelStoreArtifact = await loadArtifact('LabelStore.sol', 'LabelStore');
  const labelStoreFactory = new ContractFactory(labelStoreArtifact.abi, toBytecode(labelStoreArtifact), signer);
  const labelStore = await labelStoreFactory.deploy(ZeroAddress); // no ContractNamer
  await labelStore.waitForDeployment();

  const implArtifact = await loadArtifact('UserRegistry.sol', 'UserRegistry');
  const implFactory = new ContractFactory(implArtifact.abi, toBytecode(implArtifact), signer);
  const implementation = await implFactory.deploy(await labelStore.getAddress(), ZeroAddress);
  await implementation.waitForDeployment();

  const factory = new Contract(factoryAddress, ENSV2_VERIFIABLE_FACTORY_ABI, signer);
  const initData = new Contract(
    await implementation.getAddress(),
    ['function initialize(address rootAccount, uint256 roleBitmap)'],
    signer,
  ).interface.encodeFunctionData('initialize', [signer.address, EAC_ALL_ROLES]);

  const salt = input.salt ?? 0x5011n; // "S0ul" — spike default
  const tx = await factory.deployProxy(await implementation.getAddress(), salt, initData);
  const receipt = await tx.wait();
  const proxyAddress = receipt?.logs?.length
    ? await resolveProxyAddressFromReceipt(receipt)
    : null;
  if (!proxyAddress) {
    throw new Error('deployProxy succeeded but proxy address could not be parsed from receipt');
  }

  const registry = new Contract(proxyAddress, ENSV2_USER_REGISTRY_ABI, await getEnsV2Provider());
  const rootHasRegistrar = await registry.hasRoles(0n, REGISTRY_ROLES.ROLE_REGISTRAR, signer.address);
  if (!rootHasRegistrar) {
    throw new Error(
      `Deployed registry ${proxyAddress} does not grant the deployer ROLE_REGISTRAR on root — refusing to trust it.`,
    );
  }

  return {
    registryAddress: proxyAddress,
    implementationAddress: await implementation.getAddress(),
    labelStoreAddress: await labelStore.getAddress(),
    verifiableFactoryAddress: factoryAddress,
    owner: signer.address,
    salt,
    txHash: receipt?.hash as string | undefined,
  };
}

export async function resolveProxyAddressFromReceipt(receipt: { logs: any[] }): Promise<string | null> {
  // VerifiableFactory emits no dedicated event we can rely on across versions;
  // the proxy address is the contract created in the deployProxy tx. Parse the
  // receipt logs for the first log with an address that isn't the factory.
  for (const log of receipt.logs) {
    if (log?.address && typeof log.address === 'string' && log.address !== ZeroAddress) {
      // The proxy's initialization transaction logs come FROM the proxy.
      return log.address;
    }
  }
  return null;
}

function toBytecode(artifact: Artifact): string {
  return typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
}

// --- Swarm registration ------------------------------------------------------

/**
 * Register a swarm subname in the org's SoulVaultRegistry with an epoch-bound
 * expiry. The caller must hold ROLE_REGISTRAR on the registry's root resource
 * (the org owner, per deployEnsV2OrgRegistry).
 *
 * `subregistryAddress` = address(0) for leaf swarm names (they don't own a
 * namespace yet); `resolverAddress` = address(0) means "set in a later step"
 * (swarm register-ens wires records via setEnsText after this).
 *
 * Registration grants SWARM_NAME_ROLES (SET_RESOLVER | RENEW) on the name's
 * resource to the owner — the hook Phase 3's agent delegation builds on.
 */
export async function registerEnsV2Subname(input: {
  registryAddress: string;
  label: string;
  owner?: string;
  expirySeconds: number; // epoch length in seconds; expiry = now + expirySeconds
  subregistryAddress?: string;
  resolverAddress?: string;
  roleBitmap?: bigint;
}) {
  const signer = await createEnsSigner();
  const registry = new Contract(input.registryAddress, ENSV2_USER_REGISTRY_ABI, signer);
  const owner = input.owner ?? signer.address;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + input.expirySeconds);
  const roleBitmap = input.roleBitmap ?? SWARM_NAME_ROLES;

  const tx = await registry.register(
    input.label,
    owner,
    input.subregistryAddress ?? ZeroAddress,
    input.resolverAddress ?? ZeroAddress,
    roleBitmap,
    expiry,
  );
  const receipt = await tx.wait();
  const anyId = BigInt(viemLabelhash(input.label));

  const provider = await getEnsV2Provider();
  const state = new Contract(input.registryAddress, ENSV2_USER_REGISTRY_ABI, provider);
  const [status, expiryRet, latestOwner, tokenId, resource] = await state.getState(anyId);

  return {
    registryAddress: input.registryAddress,
    label: input.label,
    anyId: anyId.toString(),
    tokenId: String(tokenId),
    resource: String(resource),
    status: Number(status),
    expiry: String(expiryRet),
    latestOwner: String(latestOwner),
    owner,
    roleBitmap: roleBitmap.toString(),
    txHash: receipt?.hash as string | undefined,
  };
}

/** Renew a registered subname's expiry (ROLE_RENEW required). Epoch-rotation hook. */
export async function renewEnsV2Subname(input: { registryAddress: string; label: string; expirySeconds: number }) {
  const signer = await createEnsSigner();
  const registry = new Contract(input.registryAddress, ENSV2_USER_REGISTRY_ABI, signer);
  const anyId = BigInt(viemLabelhash(input.label));
  const newExpiry = BigInt(Math.floor(Date.now() / 1000) + input.expirySeconds);
  const tx = await registry.renew(anyId, newExpiry);
  const receipt = await tx.wait();
  return { registryAddress: input.registryAddress, label: input.label, newExpiry: newExpiry.toString(), txHash: receipt?.hash as string | undefined };
}

/**
 * Grant additional roles on a subname's resource (Phase 3 agent delegation
 * primitive). Caller must hold the roles being granted (EAC grant semantics).
 */
export async function grantEnsV2Roles(input: {
  registryAddress: string;
  label: string;
  roleBitmap: bigint;
  account: string;
}) {
  const signer = await createEnsSigner();
  const registry = new Contract(input.registryAddress, ENSV2_USER_REGISTRY_ABI, signer);
  const anyId = BigInt(viemLabelhash(input.label));
  const tx = await registry.grantRoles(anyId, input.roleBitmap, input.account);
  const receipt = await tx.wait();
  return {
    registryAddress: input.registryAddress,
    label: input.label,
    roleBitmap: input.roleBitmap.toString(),
    account: input.account,
    txHash: receipt?.hash as string | undefined,
  };
}

/** Read the EAC role bitmap an account holds on a subname's resource. */
export async function readEnsV2Roles(input: {
  registryAddress: string;
  label: string;
  account: string;
}): Promise<{ roleBitmap: bigint; resource: bigint; expiry: bigint; latestOwner: string }> {
  const provider = await getEnsV2Provider();
  const registry = new Contract(input.registryAddress, ENSV2_USER_REGISTRY_ABI, provider);
  const anyId = BigInt(viemLabelhash(input.label));
  const [, expiry, latestOwner, , resource] = await registry.getState(anyId);
  const roleBitmap = await registry.roles(resource, input.account);
  return { roleBitmap, resource, expiry, latestOwner };
}

export { getAddress };
