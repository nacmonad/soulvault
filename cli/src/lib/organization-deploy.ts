import fs from 'fs-extra';
import path from 'node:path';
import { ContractFactory } from 'ethers';
import { namehash } from 'viem/ens';
import { loadEnv } from './config.js';
import { createSigner } from './signer.js';
import { createEnsSigner, getPublicResolver, readEnsNodeOwner } from './ens.js';
import { resolveRepoRoot } from './paths.js';

const ORGANIZATION_ARTIFACT_PATH = path.join(
  resolveRepoRoot(),
  'out',
  'SoulVaultOrganization.sol',
  'SoulVaultOrganization.json',
);

type Artifact = {
  abi: any[];
  bytecode: { object: string } | string;
};

async function loadOrganizationArtifact(): Promise<Artifact> {
  if (!(await fs.pathExists(ORGANIZATION_ARTIFACT_PATH))) {
    throw new Error(
      `SoulVaultOrganization artifact not found at ${ORGANIZATION_ARTIFACT_PATH}. ` +
        `Run \`forge build\` from the repo root first.`,
    );
  }
  return fs.readJson(ORGANIZATION_ARTIFACT_PATH) as Promise<Artifact>;
}

/** Deploy a fresh SoulVaultOrganization contract on the ops lane (0G Galileo). */
export async function deploySoulVaultOrganizationContract() {
  const signer = await createSigner();
  const artifact = await loadOrganizationArtifact();
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
 * Write the organization contract discovery text records on the org's existing ENS name.
 *
 * Unlike swarms, the organization contract does NOT get a dedicated subdomain — it's org-scoped
 * (exactly one per org), so we attach it directly as two text records on the org's
 * root ENS name:
 *   - `soulvault.orgContract` → the organization contract address
 *   - `soulvault.orgChainId`  → the chainId where the organization contract is deployed (0G = 16602)
 *
 * Optionally also sets ERC-4824-style metadata when provided: `daoURI`, `soulvault.membersURI`,
 * `soulvault.governanceURI`, `soulvault.contractsURI`.
 *
 * This mirrors the cross-chain discovery pattern swarms already use.
 */
export async function bindOrganizationEnsTextRecords(input: {
  organizationEnsName: string;
  contractAddress: string;
  daoURI?: string;
  membersURI?: string;
  governanceURI?: string;
  contractsURI?: string;
}) {
  const env = loadEnv();
  // Verify the org ENS name actually exists and is owned before we try to write text records.
  const owner = await readEnsNodeOwner(input.organizationEnsName);
  if (!owner.owner || owner.owner === '0x0000000000000000000000000000000000000000') {
    throw new Error(
      `Organization ENS name "${input.organizationEnsName}" is not registered. ` +
        `Run \`soulvault organization register-ens\` first, then re-run organization contract create.`,
    );
  }

  const resolver = await getPublicResolver(true);
  const orgNode = namehash(input.organizationEnsName);

  const setContractTx = await resolver.setText(
    orgNode,
    'soulvault.orgContract',
    input.contractAddress,
  );
  const setContractReceipt = await setContractTx.wait();

  const setChainIdTx = await resolver.setText(
    orgNode,
    'soulvault.orgChainId',
    String(env.SOULVAULT_CHAIN_ID),
  );
  const setChainIdReceipt = await setChainIdTx.wait();

  const out: {
    node: `0x${string}`;
    contractTextTxHash: string | undefined;
    chainIdTextTxHash: string | undefined;
    daoURITextTxHash?: string;
    membersURITextTxHash?: string;
    governanceURITextTxHash?: string;
    contractsURITextTxHash?: string;
  } = {
    node: orgNode,
    contractTextTxHash: setContractReceipt?.hash,
    chainIdTextTxHash: setChainIdReceipt?.hash,
  };

  if (input.daoURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'daoURI', input.daoURI);
    const receipt = await tx.wait();
    out.daoURITextTxHash = receipt?.hash;
  }
  if (input.membersURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'soulvault.membersURI', input.membersURI);
    const receipt = await tx.wait();
    out.membersURITextTxHash = receipt?.hash;
  }
  if (input.governanceURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'soulvault.governanceURI', input.governanceURI);
    const receipt = await tx.wait();
    out.governanceURITextTxHash = receipt?.hash;
  }
  if (input.contractsURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'soulvault.contractsURI', input.contractsURI);
    const receipt = await tx.wait();
    out.contractsURITextTxHash = receipt?.hash;
  }

  return out;
}

/**
 * Set only optional ERC-4824-style metadata text records on the org ENS name (no orgContract/orgChainId).
 */
export async function setOrganizationMetadataEnsRecords(input: {
  organizationEnsName: string;
  daoURI?: string;
  membersURI?: string;
  governanceURI?: string;
  contractsURI?: string;
}) {
  const hasAny =
    input.daoURI !== undefined ||
    input.membersURI !== undefined ||
    input.governanceURI !== undefined ||
    input.contractsURI !== undefined;
  if (!hasAny) {
    throw new Error(
      'At least one of daoURI, membersURI, governanceURI, contractsURI must be provided.',
    );
  }

  const owner = await readEnsNodeOwner(input.organizationEnsName);
  if (!owner.owner || owner.owner === '0x0000000000000000000000000000000000000000') {
    throw new Error(
      `Organization ENS name "${input.organizationEnsName}" is not registered. ` +
        `Run \`soulvault organization register-ens\` first.`,
    );
  }

  const resolver = await getPublicResolver(true);
  const orgNode = namehash(input.organizationEnsName);

  const out: {
    node: `0x${string}`;
    daoURITextTxHash?: string;
    membersURITextTxHash?: string;
    governanceURITextTxHash?: string;
    contractsURITextTxHash?: string;
  } = { node: orgNode };

  if (input.daoURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'daoURI', input.daoURI);
    const receipt = await tx.wait();
    out.daoURITextTxHash = receipt?.hash;
  }
  if (input.membersURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'soulvault.membersURI', input.membersURI);
    const receipt = await tx.wait();
    out.membersURITextTxHash = receipt?.hash;
  }
  if (input.governanceURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'soulvault.governanceURI', input.governanceURI);
    const receipt = await tx.wait();
    out.governanceURITextTxHash = receipt?.hash;
  }
  if (input.contractsURI !== undefined) {
    const tx = await resolver.setText(orgNode, 'soulvault.contractsURI', input.contractsURI);
    const receipt = await tx.wait();
    out.contractsURITextTxHash = receipt?.hash;
  }

  return out;
}

// Ensure the createEnsSigner import isn't marked unused — it's kept here so downstream
// helpers (e.g. read-back verification) can use the same signer factory.
export { createEnsSigner };
