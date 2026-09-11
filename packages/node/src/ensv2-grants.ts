// ---------------------------------------------------------------------------
// ENSv2 Phase 3 — EAC role wiring (the agent unlock)
// ---------------------------------------------------------------------------
//
// Scoped delegation on the org's SoulVaultRegistry: the org owner grants an
// agent wallet exactly the roles it needs on ONE name's resource (e.g.
// ROLE_SET_RESOLVER on `ops.<org>.eth`), so the agent can refresh its own ENS
// metadata without ever touching the org Ledger or sibling names. This is the
// EAC demo the prize brief describes: per-name, per-role, revocable.
//
// All functions accept a fully-qualified name and resolve the registry holding
// it via readEnsV2NameState (hierarchy walk), so callers never handle
// registry addresses or resource IDs directly.

import { Contract } from 'ethers';
import { labelhash as viemLabelhash } from 'viem/ens';
import { createEnsSigner } from './ens.js';
import { getEnsV2Provider, readEnsV2NameState, hasEnsV2Roles } from './ensv2.js';
import { ENSV2_USER_REGISTRY_ABI } from './ensv2-registry.js';

/** CLI-facing role names → RegistryRolesLib bit positions (nybble-packed). */
export const ENSV2_ROLE_NAMES = {
  'registrar': 1n << 0n,
  'register-reserved': 1n << 4n,
  'set-parent': 1n << 8n,
  'unregister': 1n << 12n,
  'renew': 1n << 16n,
  'set-subregistry': 1n << 20n,
  'set-resolver': 1n << 24n,
} as const;

export type EnsV2RoleName = keyof typeof ENSV2_ROLE_NAMES;

/** Parse a comma-separated role list ("set-resolver,renew") into a bitmap. */
export function parseEnsV2RoleBitmap(spec: string): bigint {
  let bitmap = 0n;
  for (const raw of spec.split(',')) {
    const name = raw.trim().toLowerCase();
    if (name === '') continue;
    const bit = ENSV2_ROLE_NAMES[name as EnsV2RoleName];
    if (bit === undefined) {
      throw new Error(
        `Unknown ENSv2 role "${name}". Valid roles: ${Object.keys(ENSV2_ROLE_NAMES).join(', ')}.`,
      );
    }
    bitmap |= bit;
  }
  if (bitmap === 0n) {
    throw new Error(`Empty role bitmap — pass at least one role, e.g. --role set-resolver.`);
  }
  return bitmap;
}

/** Human-readable role list for a bitmap (inverse of parseEnsV2RoleBitmap). */
export function formatEnsV2RoleBitmap(bitmap: bigint): string[] {
  return Object.entries(ENSV2_ROLE_NAMES)
    .filter(([, bit]) => (bitmap & bit) !== 0n)
    .map(([name]) => name);
}

/**
 * Grant roles on a name's resource. Caller must hold the roles being granted
 * (EAC grant semantics — you can only delegate what you hold). The org owner
 * got ALL root roles at initialize(), so they can grant anything on any name
 * in their namespace.
 */
export async function grantEnsV2RoleByName(input: {
  fullName: string;
  roleSpec: string;
  account: string;
}) {
  const roleBitmap = parseEnsV2RoleBitmap(input.roleSpec);
  const state = await readEnsV2NameState(input.fullName);
  if (!state) {
    throw new Error(
      `Name "${input.fullName}" is not registered on ENSv2 — register it first (\`swarm register-ens\`).`,
    );
  }
  const signer = await createEnsSigner();
  const registry = new Contract(state.registryAddress, ENSV2_USER_REGISTRY_ABI, signer);
  // grantRoles is anyId-keyed: the registry derives resource = getResource(anyId).
  const anyId = BigInt(viemLabelhash(input.fullName.split('.')[0]));
  const tx = await registry.grantRoles(anyId, roleBitmap, input.account);
  const receipt = await tx.wait();

  // Verify the grant landed before claiming success.
  const granted = await hasEnsV2Roles(input.fullName, roleBitmap, input.account);
  if (!granted) {
    throw new Error(
      `grantRoles tx mined (${receipt?.hash}) but ${input.account} still does not verify for ` +
        `the roles on "${input.fullName}" — check the caller holds the roles being granted.`,
    );
  }
  return {
    fullName: input.fullName,
    account: input.account,
    roleBitmap: roleBitmap.toString(),
    roles: formatEnsV2RoleBitmap(roleBitmap),
    resource: state.resource.toString(),
    registryAddress: state.registryAddress,
    txHash: receipt?.hash as string | undefined,
  };
}

/** Revoke roles on a name's resource (agent offboarding / role rotation). */
export async function revokeEnsV2RoleByName(input: {
  fullName: string;
  roleSpec: string;
  account: string;
}) {
  const roleBitmap = parseEnsV2RoleBitmap(input.roleSpec);
  const state = await readEnsV2NameState(input.fullName);
  if (!state) {
    throw new Error(`Name "${input.fullName}" is not registered on ENSv2.`);
  }
  const signer = await createEnsSigner();
  const registry = new Contract(state.registryAddress, ENSV2_USER_REGISTRY_ABI, signer);
  const anyId = BigInt(viemLabelhash(input.fullName.split('.')[0]));
  const tx = await registry.revokeRoles(anyId, roleBitmap, input.account);
  const receipt = await tx.wait();
  const stillHas = await hasEnsV2Roles(input.fullName, roleBitmap, input.account);
  if (stillHas) {
    throw new Error(
      `revokeRoles tx mined (${receipt?.hash}) but ${input.account} STILL holds the roles on ` +
        `"${input.fullName}" — revocation did not take effect.`,
    );
  }
  return {
    fullName: input.fullName,
    account: input.account,
    roles: formatEnsV2RoleBitmap(roleBitmap),
    resource: state.resource.toString(),
    txHash: receipt?.hash as string | undefined,
  };
}

/** Read the role bitmap an account holds on a name's resource, as role names. */
export async function readEnsV2RolesByName(input: { fullName: string; account: string }) {
  const state = await readEnsV2NameState(input.fullName);
  if (!state) return null;
  const provider = await getEnsV2Provider();
  const registry = new Contract(state.registryAddress, ENSV2_USER_REGISTRY_ABI, provider);
  const bitmap = await registry.roles(state.resource, input.account);
  return {
    fullName: input.fullName,
    account: input.account,
    roleBitmap: bitmap.toString(),
    roles: formatEnsV2RoleBitmap(bitmap),
    resource: state.resource.toString(),
    registryAddress: state.registryAddress,
    expiry: state.expiry,
    status: state.status,
  };
}

/**
 * Agent self-serve record write: assert the active signer holds ROLE_SET_RESOLVER
 * on the name BEFORE sending (actionable error instead of an onchain revert),
 * then setText through the name's v2 resolver.
 */
export async function setEnsV2TextScoped(input: {
  fullName: string;
  key: string;
  value: string;
  signerAddress: string;
}) {
  const ok = await hasEnsV2Roles(input.fullName, 1n << 24n /* ROLE_SET_RESOLVER */, input.signerAddress);
  if (!ok) {
    throw new Error(
      `Signer ${input.signerAddress} lacks ROLE_SET_RESOLVER on "${input.fullName}". ` +
        `Ask the org owner: soulvault ens grant --name ${input.fullName} --role set-resolver --to ${input.signerAddress}`,
    );
  }
  // setEnsText dispatches to the v2 resolver when SOULVAULT_ENSV2=1.
  const { setEnsText } = await import('./ens.js');
  return setEnsText(input.fullName, input.key, input.value);
}
