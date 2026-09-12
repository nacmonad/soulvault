// ---------------------------------------------------------------------------
// Phase 4 — ENSv2 epoch-renewal hook
// ---------------------------------------------------------------------------
//
// Spec Phase 4, item 9: swarm subname expiry = epoch end; renewal extends on
// epoch rotation ("expiry = liveness signal"). Kept in its own module so the
// epoch-bundle import chain stays light (this one only touches the org profile
// store + v2 state/registry clients).
//
// Best-effort by design: a renewal failure must never roll back an epoch
// rotation (the key bundle is already published onchain by the time this runs).
// Every skip path returns a `reason` the CLI can surface.

import type { SwarmProfile } from './swarm.js';

export type EnsRenewalResult = {
  renewed: boolean;
  fullName?: string;
  newExpiry?: string;
  txHash?: string;
  reason?: string;
};

/** Default epoch cadence for subname expiry (matches `swarm register-ens`). */
export const DEFAULT_ENSV2_EPOCH_SECONDS = 30 * 86400;

/**
 * Renew the swarm's ENSv2 subname so its expiry tracks the epoch cadence.
 * No-op (with reason) when the swarm has no v2 subname, the org has no deployed
 * registry, or the name is not registered — v1-only setups keep rotating epochs.
 */
export async function renewSwarmEnsV2Subname(
  profile: SwarmProfile,
  input: { expirySeconds?: number } = {},
): Promise<EnsRenewalResult> {
  if (!profile.ensName || !profile.organizationEnsName) {
    return { renewed: false, reason: 'no v2 subname bound to this swarm' };
  }
  const { getOrganizationProfile } = await import('./organization.js');
  const org = await getOrganizationProfile(profile.organizationEnsName);
  if (!org?.ensv2Registry?.address) {
    return {
      renewed: false,
      reason: 'org has no deployed ensv2Registry (run `organization deploy-registry`)',
    };
  }
  // Guard: is the swarm name actually registered in the v2 registry?
  const { readEnsV2NameState } = await import('./ensv2.js');
  const state = await readEnsV2NameState(profile.ensName);
  if (!state) {
    return {
      renewed: false,
      reason: `${profile.ensName} is not registered on ENSv2 (run \`swarm register-ens\`)`,
    };
  }
  const { renewEnsV2Subname } = await import('./ensv2-registry.js');
  const result = await renewEnsV2Subname({
    registryAddress: org.ensv2Registry.address,
    label: profile.ensName.replace(`.${profile.organizationEnsName}`, ''),
    expirySeconds: input.expirySeconds ?? DEFAULT_ENSV2_EPOCH_SECONDS,
  });
  return {
    renewed: true,
    fullName: profile.ensName,
    newExpiry: result.newExpiry,
    txHash: result.txHash,
  };
}
