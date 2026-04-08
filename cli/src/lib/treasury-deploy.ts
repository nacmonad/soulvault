import fs from 'fs-extra';
import path from 'node:path';
import { ContractFactory } from 'ethers';
import { namehash } from 'viem/ens';
import { loadEnv } from './config.js';
import { createSigner } from './signer.js';
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
