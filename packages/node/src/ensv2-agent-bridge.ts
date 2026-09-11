// ---------------------------------------------------------------------------
// ENSv2 ↔ ERC-8004 agent bridge (Phase 4, item 11)
// ---------------------------------------------------------------------------
//
// Spec: "agent registration writes `<agent>.<swarm>.soulvault.eth` into the
// ERC-8004 URI; `soulvault agent show` resolves reverse records via ENSv2."
//
// Layout (spec §3 tree): agent names are entries in the org's SoulVaultRegistry
// — the SAME registry that holds swarm labels. For
// `<agent>.<swarm>.<org>.eth` to resolve, the swarm name must have been
// registered with a subregistry (`--with-agent-namespace` on `swarm
// register-ens` self-points the swarm's subregistry at the org registry).
//
// After registration the agent wallet holds SET_RESOLVER|RENEW on its own name
// resource — the Phase 3 self-serve unlock, now per-agent.

import { Contract, ZeroAddress } from 'ethers';
import { labelhash as viemLabelhash } from 'viem/ens';
import { getAgentProfile } from './agent.js';
import { createEnsSigner } from './ens.js';
import { getEnsV2Provider } from './ensv2.js';
import { ENSV2_USER_REGISTRY_ABI } from './ensv2-registry.js';
import { getOrganizationProfile } from './organization.js';
import { getSwarmProfile, type SwarmProfile } from './swarm.js';

/** Text records written on the agent name's resolver (spec §3: ERC-8004 bridge). */
export const AGENT_ENS_RECORDS = {
  'erc8004.registry': 'soulvault.erc8004.registry',
  'erc8004.agentId': 'soulvault.erc8004.agentId',
  'soulvault.agentName': 'soulvault.agentName',
} as const;

export type AgentEnsNameInput = {
  swarm?: string;
  agentLabel?: string;
  organizationEnsName?: string;
};

export function buildAgentEnsName(input: AgentEnsNameInput): string {
  const label = input.agentLabel;
  if (!label) throw new Error('Missing agent label for ENS name (pass --agent-label).');
  if (!input.swarm) throw new Error('Missing swarm for ENS name (pass --swarm).');
  if (!input.organizationEnsName) throw new Error('Missing org ENS name (org profile has no ensName).');
  return `${label}.${input.swarm}.${input.organizationEnsName}`;
}

/** Resolve the org registry for a swarm profile (throws with a helpful message). */
export async function resolveOrgRegistryForSwarm(profile: SwarmProfile): Promise<string> {
  if (!profile.organizationEnsName) {
    throw new Error(`Swarm ${profile.slug} has no organizationEnsName — cannot locate its ENSv2 registry.`);
  }
  const org = await getOrganizationProfile(profile.organizationEnsName);
  const registry = org?.ensv2Registry?.address;
  if (!registry) {
    throw new Error(
      `Organization ${profile.organizationEnsName} has no deployed ensv2Registry — run \`organization deploy-registry\` first.`,
    );
  }
  return registry;
}

// --- Registration (ERC-8004 → ENSv2 write path) ------------------------------

/**
 * Register the agent's ENSv2 name and mirror its ERC-8004 identity into the
 * name's resolver records. Requires ROLE_REGISTRAR on the org registry (org
 * owner, or an agent granted the registrar role). The agent wallet receives
 * SWARM_NAME_ROLES on its own name's resource.
 */
export async function registerAgentEnsName(input: {
  swarm?: string;
  agentLabel: string;
  owner?: string;
  expirySeconds?: number;
  erc8004?: { registry?: string; agentId?: string };
}) {
  const agent = await getAgentProfile();
  if (!agent) throw new Error('No local agent profile found. Run `soulvault agent create` first.');

  const profile = input.swarm ? await getSwarmProfile(input.swarm) : null;
  const swarmProfile = profile ?? (await (await import('./swarm.js')).getActiveSwarm());
  if (!swarmProfile) throw new Error('No swarm found — pass --swarm or set an active swarm.');
  if (!swarmProfile.organizationEnsName) {
    throw new Error(`Swarm ${swarmProfile.slug} has no organizationEnsName bound — run \`swarm register-ens\` first.`);
  }

  const registryAddress = await resolveOrgRegistryForSwarm(swarmProfile);
  const fullName = buildAgentEnsName({
    swarm: swarmProfile.ensName?.split('.')[0],
    agentLabel: input.agentLabel,
    organizationEnsName: swarmProfile.organizationEnsName,
  });

  const signer = await createEnsSigner();
  const registry = new Contract(registryAddress, ENSV2_USER_REGISTRY_ABI, signer);
  const owner = input.owner ?? signer.address;
  const expirySeconds = input.expirySeconds ?? 30 * 86400;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);
  // SWARM_NAME_ROLES: SET_RESOLVER | RENEW — the agent can self-serve its own
  // records but cannot unregister, re-point the subregistry, or grant others.
  const roleBitmap = (1n << 24n) | (1n << 16n);

  const tx = await registry.register(input.agentLabel, owner, ZeroAddress, ZeroAddress, roleBitmap, expiry);
  const receipt = await tx.wait();
  const anyId = BigInt(viemLabelhash(input.agentLabel));

  // ERC-8004 → ENS records: write the identity pointer into the agent name's
  // resolver (setEnsText dispatches to v2 when enabled). Only when an identity
  // actually exists — a bare name is still useful for resolution.
  const erc8004 = {
    registry: input.erc8004?.registry ?? agent.identity?.registry,
    agentId: input.erc8004?.agentId ?? agent.identity?.agentId,
  };
  const recordTxHashes: string[] = [];
  if (erc8004.registry) {
    const { setEnsText } = await import('./ens.js');
    const r1 = await setEnsText(fullName, 'erc8004.registry', erc8004.registry);
    if (r1.txHash) recordTxHashes.push(r1.txHash);
    if (erc8004.agentId) {
      const r2 = await setEnsText(fullName, 'erc8004.agentId', erc8004.agentId);
      if (r2.txHash) recordTxHashes.push(r2.txHash);
    }
  }

  // Record the agent's v2 name on the local profile so `agent show` can do the
  // reverse lookup later (resolveAgentReverseRecord reads identity.ensName).
  const { writeAgentProfile } = await import('./state.js');
  await writeAgentProfile({
    identity: {
      ...agent.identity,
      ensName: fullName,
      updatedAt: new Date().toISOString(),
    },
  });

  // Backfill the ERC-8004 URI with the bridge name: the identity card (and any
  // external ERC-8004 reader) titles the agent by its ENS name when present.
  // Rebuild the URI from the current payload shape + ensName and update on-chain.
  if (erc8004.registry && erc8004.agentId) {
    try {
      const { updateAgentIdentityOnchain, buildAgentRegistration } = await import('./identity.js');
      const payload = buildAgentRegistration({
        name: agent.name,
        description: undefined,
        harness: agent.harness,
        backupCommand: agent.backupCommand,
        swarmContract: agent.identity?.lastAgentURI
          ? (() => { try { return JSON.parse(Buffer.from(agent.identity.lastAgentURI.replace('data:application/json;base64,',''),'base64').toString('utf8')).soulvault?.swarmContract; } catch { return undefined; } })()
          : undefined,
        registryAddress: erc8004.registry,
      });
      payload.soulvault.memberAddress = agent.address;
      payload.soulvault.ensName = fullName;
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
      const uri = `data:application/json;base64,${encoded}`;
      const signer2 = await createEnsSigner();
      const adapter = new Contract(erc8004.registry, (await import('./identity.js')).ERC8004_ADAPTER_ABI, signer2);
      const updateTx = await adapter.updateAgentURI(BigInt(erc8004.agentId), uri);
      await updateTx.wait();
    } catch {
      // URI backfill is best-effort — the name itself is already registered
      // and recorded locally; a failed update doesn't invalidate the bridge.
    }
  }

  return {
    fullName,
    registryAddress,
    label: input.agentLabel,
    anyId: anyId.toString(),
    owner,
    roleBitmap: roleBitmap.toString(),
    erc8004,
    txHash: receipt?.hash as string | undefined,
    recordTxHashes,
  };
}

// --- Reverse resolution (ENSv2 → ERC-8004 read path) -------------------------

/**
 * Reverse lookup for `soulvault agent show`: read the ERC-8004 pointer records
 * from an agent's ENSv2 name. Returns what it found — callers render it.
 */
export async function readAgentEnsBridge(input: { fullName: string }) {
  const { readEnsText } = await import('./ens.js');
  const [erc8004Registry, erc8004AgentId, agentName] = await Promise.all([
    readEnsText(input.fullName, 'erc8004.registry'),
    readEnsText(input.fullName, 'erc8004.agentId'),
    readEnsText(input.fullName, 'soulvault.agentName'),
  ]);
  return {
    fullName: input.fullName,
    erc8004: {
      registry: erc8004Registry || undefined,
      agentId: erc8004AgentId || undefined,
    },
    agentName: agentName || undefined,
  };
}

/**
 * Full reverse resolution: from the local agent profile, find its ENS name
 * (via the swarm it belongs to) and read the ERC-8004 bridge records back.
 * Used by `soulvault agent show` when a v2 namespace is configured.
 */
export async function resolveAgentReverseRecord(input: { swarm?: string } = {}) {
  const agent = await getAgentProfile();
  if (!agent) throw new Error('No local agent profile found. Run `soulvault agent create` first.');

  const swarmProfile = input.swarm
    ? await getSwarmProfile(input.swarm)
    : await (await import('./swarm.js')).getActiveSwarm();
  if (!swarmProfile?.ensName || !swarmProfile.organizationEnsName) {
    return null; // no v2 namespace bound — caller falls back to plain show
  }

  // The agent label isn't stored on the profile; derive from the swarm-registered
  // agent name recorded during registerAgentEnsName (identity.ensName).
  const agentEnsName = agent.identity?.ensName;
  if (!agentEnsName) return null;

  return readAgentEnsBridge({ fullName: agentEnsName });
}
