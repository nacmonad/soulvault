import { Contract, parseEther, formatEther } from 'ethers';
import { createProvider, createSigner } from './signer.js';
import { requireTreasuryProfile, resolveTargetOrganization } from './treasury.js';
import { getSwarmProfile } from './swarm.js';
import { SOULVAULT_TREASURY_ABI } from './swarm-contract.js';

async function resolveTargetTreasury(orgNameOrSlug?: string) {
  const organization = await resolveTargetOrganization(orgNameOrSlug);
  const profile = await requireTreasuryProfile(organization.slug);
  return { organization, profile };
}

export async function getTreasuryContractReadonly(orgNameOrSlug?: string) {
  const { organization, profile } = await resolveTargetTreasury(orgNameOrSlug);
  const provider = await createProvider();
  const contract = new Contract(profile.contractAddress, SOULVAULT_TREASURY_ABI, provider);
  return { organization, profile, contract };
}

export async function getTreasuryContract(orgNameOrSlug?: string) {
  const { organization, profile } = await resolveTargetTreasury(orgNameOrSlug);
  const signer = await createSigner();
  const contract = new Contract(profile.contractAddress, SOULVAULT_TREASURY_ABI, signer);
  return { organization, profile, contract };
}

/** Read treasury status (owner + balance + recent event counts). */
export async function getTreasuryStatus(input: { organization?: string }) {
  const { profile, contract } = await getTreasuryContractReadonly(input.organization);
  const [owner, balance] = await Promise.all([contract.owner(), contract.balance()]);
  return {
    organization: profile.organization,
    contractAddress: profile.contractAddress,
    owner: String(owner),
    balanceWei: balance.toString(),
    balanceEther: formatEther(balance),
  };
}

/** Send native value to the treasury contract. Any wallet can deposit. */
export async function depositToTreasury(input: { organization?: string; amountEther: string }) {
  const { profile, contract } = await getTreasuryContract(input.organization);
  const amountWei = parseEther(input.amountEther);
  const tx = await contract.deposit({ value: amountWei });
  const receipt = await tx.wait();
  return {
    organization: profile.organization,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    amountWei: amountWei.toString(),
    amountEther: input.amountEther,
  };
}

/** Owner-only withdraw. Contract enforces access control. */
export async function withdrawFromTreasury(input: {
  organization?: string;
  to: string;
  amountEther: string;
}) {
  const { profile, contract } = await getTreasuryContract(input.organization);
  const amountWei = parseEther(input.amountEther);
  const tx = await contract.withdraw(input.to, amountWei);
  const receipt = await tx.wait();
  return {
    organization: profile.organization,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    to: input.to,
    amountWei: amountWei.toString(),
    amountEther: input.amountEther,
  };
}

/**
 * Treasury owner approves a pending fund request on the given swarm. Executes the payout
 * in the same transaction (swarm-side status flips to APPROVED, then native value transfers
 * from treasury to requester).
 *
 * The swarm argument is resolved against local swarm profiles first; raw addresses are also
 * accepted but trigger a console warning — see the CLI command handler for the warning text.
 */
export async function approveFundRequestViaTreasury(input: {
  organization?: string;
  swarm: string;
  requestId: string;
}) {
  const { profile, contract } = await getTreasuryContract(input.organization);
  const swarmAddress = await resolveSwarmAddress(input.swarm);
  const tx = await contract.approveFundRequest(swarmAddress, input.requestId);
  const receipt = await tx.wait();

  // Parse FundsReleased from receipt logs (treasury emits this after the transfer).
  let released: { recipient?: string; amountWei?: string } = {};
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'FundsReleased') {
        released = {
          recipient: String(parsed.args.recipient),
          amountWei: parsed.args.amount.toString(),
        };
        break;
      }
    } catch {
      // log may be from the swarm contract — ignore, we only want FundsReleased
    }
  }

  return {
    organization: profile.organization,
    treasuryContractAddress: profile.contractAddress,
    swarmAddress,
    requestId: input.requestId,
    txHash: receipt?.hash,
    recipient: released.recipient,
    amountWei: released.amountWei,
  };
}

/** Treasury owner rejects a pending fund request. No funds move. */
export async function rejectFundRequestViaTreasury(input: {
  organization?: string;
  swarm: string;
  requestId: string;
  reason: string;
}) {
  const { profile, contract } = await getTreasuryContract(input.organization);
  const swarmAddress = await resolveSwarmAddress(input.swarm);
  const tx = await contract.rejectFundRequest(swarmAddress, input.requestId, input.reason);
  const receipt = await tx.wait();
  return {
    organization: profile.organization,
    treasuryContractAddress: profile.contractAddress,
    swarmAddress,
    requestId: input.requestId,
    reason: input.reason,
    txHash: receipt?.hash,
  };
}

/**
 * Resolve a swarm name/ens/address into a raw contract address. If the input looks like
 * an address (starts with `0x` and is 42 chars), it's returned as-is. Otherwise we look
 * up the local swarm profile and use its contractAddress.
 */
export async function resolveSwarmAddress(nameOrAddress: string): Promise<string> {
  if (/^0x[0-9a-fA-F]{40}$/.test(nameOrAddress)) {
    return nameOrAddress;
  }
  const profile = await getSwarmProfile(nameOrAddress);
  if (!profile) {
    throw new Error(`Swarm not found: "${nameOrAddress}". Pass a local swarm name/slug or a raw contract address.`);
  }
  if (!profile.contractAddress) {
    throw new Error(`Swarm "${nameOrAddress}" has no deployed contract address yet.`);
  }
  return profile.contractAddress;
}

/** Detect whether the input is a raw address (no local profile lookup performed). */
export function isRawAddress(input: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(input);
}
