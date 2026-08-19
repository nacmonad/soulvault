import fs from 'fs-extra';
import path from 'node:path';
import { ContractFactory } from 'ethers';
import { namehash } from 'viem/ens';
import { loadEnv } from './config.js';
import { createSigner } from './signer.js';
import { createEnsSigner, getPublicResolver, readEnsNodeOwner } from './ens.js';
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
 * Write the treasury discovery text records on the org's existing ENS name.
 *
 * Unlike swarms, the treasury does NOT get a dedicated subdomain — it's org-scoped
 * (exactly one per org), so we attach it directly as two text records on the org's
 * root ENS name:
 *   - `soulvault.treasuryContract` → the treasury contract address
 *   - `soulvault.treasuryChainId`  → the chainId where the treasury is deployed (0G = 16602)
 *
 * This mirrors the cross-chain discovery pattern swarms already use.
 */
export async function bindTreasuryEnsTextRecords(input: {
  organizationEnsName: string;
  contractAddress: string;
}) {
  const env = loadEnv();
  // Verify the org ENS name actually exists and is owned before we try to write text records.
  const owner = await readEnsNodeOwner(input.organizationEnsName);
  if (!owner.owner || owner.owner === '0x0000000000000000000000000000000000000000') {
    throw new Error(
      `Organization ENS name "${input.organizationEnsName}" is not registered. ` +
        `Run \`soulvault organization register-ens\` first, then re-run treasury create.`,
    );
  }

  const resolver = await getPublicResolver(true);
  const orgNode = namehash(input.organizationEnsName);

  const setContractTx = await resolver.setText(
    orgNode,
    'soulvault.treasuryContract',
    input.contractAddress,
  );
  const setContractReceipt = await setContractTx.wait();

  const setChainIdTx = await resolver.setText(
    orgNode,
    'soulvault.treasuryChainId',
    String(env.SOULVAULT_CHAIN_ID),
  );
  const setChainIdReceipt = await setChainIdTx.wait();

  return {
    node: orgNode,
    contractTextTxHash: setContractReceipt?.hash,
    chainIdTextTxHash: setChainIdReceipt?.hash,
  };
}

// Ensure the createEnsSigner import isn't marked unused — it's kept here so downstream
// helpers (e.g. read-back verification) can use the same signer factory.
export { createEnsSigner };
