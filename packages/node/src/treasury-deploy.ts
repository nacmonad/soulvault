import fs from 'fs-extra';
import path from 'node:path';
import { Contract, ContractFactory } from 'ethers';
import { namehash } from 'viem/ens';
import { loadEnv } from './config.js';
import { createProvider, createSigner } from './signer.js';
import {
  resolveTargetOrganization,
  getTreasuryProfile,
  buildTreasuryProfile,
  writeTreasuryProfile,
} from './treasury.js';
import { isAddress } from 'ethers';
import {
  createEnsSigner,
  coinTypeForChain,
  readEnsNodeOwner,
  setAddrMultichain,
} from './ens.js';
import { resolveRepoRoot } from './paths.js';

const TREASURY_ARTIFACT_PATH = path.join(
  resolveRepoRoot(),
  'out',
  'SoulVaultTreasury.sol',
  'SoulVaultTreasury.json',
);

type Artifact = {
  abi: any[];
  bytecode: { object: string } | string;
};

async function loadTreasuryArtifact(): Promise<Artifact> {
  if (!(await fs.pathExists(TREASURY_ARTIFACT_PATH))) {
    throw new Error(
      `SoulVaultTreasury artifact not found at ${TREASURY_ARTIFACT_PATH}. ` +
        `Run \`forge build\` from the repo root first.`,
    );
  }
  return fs.readJson(TREASURY_ARTIFACT_PATH) as Promise<Artifact>;
}

/** Deploy a fresh SoulVaultTreasury contract on the ops lane (0G Galileo). */
export async function deploySoulVaultTreasuryContract() {
  const signer = await createSigner();
  const artifact = await loadTreasuryArtifact();
  const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
  const factory = new ContractFactory(artifact.abi, bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const deploymentTx = contract.deploymentTransaction();
  return {
    address: await contract.getAddress(),
    ownerAddress: signer.address,
    txHash: deploymentTx?.hash,
  };
}

/**
 * Publish the treasury's address on the org's ENS name via ENSIP-11 multichain `addr`.
 *
 * One org may hold treasuries on multiple chains (0G Galileo, Base, etc.) — each is
 * discovered by calling `addr(node, coinType)` on the org's ENS name where `coinType`
 * is derived from the target chainId per ENSIP-11 (`0x80000000 | chainId`). This is the
 * canonical multi-chain discovery mechanism; the legacy `soulvault.treasuryContract` /
 * `soulvault.treasuryChainId` text records were single-valued and couldn't represent a
 * multi-chain org, so they've been removed.
 *
 * An org with treasuries on N chains will call this N times, once per chain, each
 * writing a distinct coinType slot. Setting one slot does not clobber the others.
 */
export async function bindTreasuryEnsAddr(input: {
  organizationEnsName: string;
  contractAddress: string;
}) {
  const env = loadEnv();
  // Verify the org ENS name actually exists and is owned before we try to write the record.
  const owner = await readEnsNodeOwner(input.organizationEnsName);
  if (!owner.owner || owner.owner === '0x0000000000000000000000000000000000000000') {
    throw new Error(
      `Organization ENS name "${input.organizationEnsName}" is not registered. ` +
        `Run \`soulvault organization register-ens\` first, then re-run treasury create.`,
    );
  }

  const orgNode = namehash(input.organizationEnsName);
  const coinType = coinTypeForChain(env.SOULVAULT_CHAIN_ID);
  const result = await setAddrMultichain(
    input.organizationEnsName,
    env.SOULVAULT_CHAIN_ID,
    input.contractAddress,
  );

  return {
    node: orgNode,
    coinType,
    chainId: env.SOULVAULT_CHAIN_ID,
    addrTxHash: result.txHash,
  };
}

// Ensure the createEnsSigner import isn't marked unused — it's kept here so downstream
// helpers (e.g. read-back verification) can use the same signer factory.
export { createEnsSigner };

/**
 * Bind an already-deployed SoulVaultTreasury to the organization: verify the contract
 * on-chain (owner() must answer — rejects non-treasury addresses), publish its address
 * on the org's ENS name via ENSIP-11, and write the local treasury profile.
 *
 * Recovery path for `treasury create` runs where the deploy succeeded but the ENS
 * binding failed (e.g. the browser wizard's partial-failure state), or for treasuries
 * deployed outside the CLI entirely.
 */
export async function bindExistingTreasury(input: {
  organization?: string;
  contractAddress: string;
  force?: boolean;
}) {
  if (!isAddress(input.contractAddress)) {
    throw new Error(`Invalid contract address: "${input.contractAddress}"`);
  }
  const organization = await resolveTargetOrganization(input.organization);

  // Verify the address is actually a SoulVaultTreasury before binding it — owner() is
  // part of the treasury surface; anything else reverts and we fail before writing ENS.
  const provider = await createProvider();
  const probe = new Contract(
    input.contractAddress,
    ['function owner() view returns (address)'],
    provider,
  );
  let onChainOwner: string;
  try {
    onChainOwner = String(await probe.owner());
  } catch {
    throw new Error(
      `${input.contractAddress} does not respond to owner() — it is not a SoulVaultTreasury contract. ` +
        `Refusing to bind it to the organization.`,
  );
  }

  const existing = await getTreasuryProfile(organization.slug);
  if (existing && existing.contractAddress !== input.contractAddress && !input.force) {
    throw new Error(
      `Treasury already exists for organization "${organization.slug}" at ${existing.contractAddress}. ` +
        `Pass --force to rebind to ${input.contractAddress}.`,
    );
  }

  // Publish the address on the org's ENS name via ENSIP-11 multichain addr. Same
  // "planned" semantics as treasury create when the org has no ENS name yet.
  let ensBinding: import('./treasury.js').TreasuryProfile['ensBinding'];
  if (organization.ensName) {
    const bound = await bindTreasuryEnsAddr({
      organizationEnsName: organization.ensName,
      contractAddress: input.contractAddress,
    });
    ensBinding = { status: 'bound' as const, coinType: bound.coinType, addrTxHash: bound.addrTxHash };
  } else {
    ensBinding = { status: 'planned' as const };
  }

  const signer = await createSigner();
  if (onChainOwner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(
      `[treasury bind] warning: on-chain owner ${onChainOwner} differs from your signer ${signer.address}. ` +
        `Only the on-chain owner can approve/withdraw from this treasury.`,
    );
  }

  const profile = buildTreasuryProfile({
    organization: organization.slug,
    organizationEnsName: organization.ensName,
    contractAddress: input.contractAddress,
    ownerAddress: onChainOwner,
    ensBinding,
  });
  if (existing?.createdAt) {
    // Rebinds keep the original profile creation date.
    profile.createdAt = existing.createdAt;
  }
  await writeTreasuryProfile(profile);

  return { profile, onChainOwner };
}
