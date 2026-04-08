import fs from 'fs-extra';
import path from 'node:path';
import { ContractFactory, id } from 'ethers';
import { namehash } from 'viem/ens';
import { createSigner } from './signer.js';
import { getEnsRegistry, getPublicResolver, createEnsSigner } from './ens.js';
import { loadEnv } from './config.js';
import { resolveRepoRoot } from './paths.js';

const ARTIFACT_PATH = path.join(resolveRepoRoot(), 'out', 'SoulVaultSwarm.sol', 'SoulVaultSwarm.json');

type Artifact = {
  abi: any[];
  bytecode: { object: string } | string;
};

async function loadArtifact(): Promise<Artifact> {
  return fs.readJson(ARTIFACT_PATH) as Promise<Artifact>;
}

/**
 * Deploy a fresh SoulVaultSwarm contract on the ops lane.
 *
 * `initialTreasury` is passed verbatim to the constructor. `ethers.ZeroAddress` (or
 * `'0x0000000000000000000000000000000000000000'`) is a fully supported value meaning
 * "stealth swarm / deferred treasury binding" — the swarm will exist with no treasury
 * bound and can be wired up later via `setTreasury`. Non-zero values take the same
 * sanity check as the post-construction path: the treasury must live on the same
 * chain as the swarm, which should be validated by the caller before reaching this
 * function.
 */
export async function deploySoulVaultSwarmContract(input: { initialTreasury: string }) {
  const signer = await createSigner();
  const artifact = await loadArtifact();
  const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
  const factory = new ContractFactory(artifact.abi, bytecode, signer);
  const contract = await factory.deploy(input.initialTreasury);
  await contract.waitForDeployment();
  const deploymentTx = contract.deploymentTransaction();
  return {
    address: await contract.getAddress(),
    ownerAddress: signer.address,
    txHash: deploymentTx?.hash,
    initialTreasury: input.initialTreasury,
  };
}

export async function bindSwarmEnsSubdomain(input: {
  organizationEnsName: string;
  swarmEnsName: string;
  contractAddress: string;
}) {
  const env = loadEnv();
  const signer = await createEnsSigner();
  const registry = await getEnsRegistry(true);
  const resolver = await getPublicResolver(true);

  const orgNode = namehash(input.organizationEnsName);
  const swarmLabel = input.swarmEnsName.replace(`.${input.organizationEnsName}`, '');
  const labelhash = id(swarmLabel);
  const swarmNode = namehash(input.swarmEnsName);

  const setSubnodeTx = await registry.setSubnodeRecord(
    orgNode,
    labelhash,
    signer.address,
    await resolver.getAddress(),
    0
  );
  const setSubnodeReceipt = await setSubnodeTx.wait();

  const setAddrTx = await resolver.setAddr(swarmNode, input.contractAddress);
  const setAddrReceipt = await setAddrTx.wait();

  const setChainIdTx = await resolver.setText(swarmNode, 'soulvault.chainId', String(env.SOULVAULT_CHAIN_ID));
  const setChainIdReceipt = await setChainIdTx.wait();

  const setContractTx = await resolver.setText(swarmNode, 'soulvault.swarmContract', input.contractAddress);
  const setContractReceipt = await setContractTx.wait();

  return {
    node: swarmNode,
    subdomainTxHash: setSubnodeReceipt?.hash,
    addrTxHash: setAddrReceipt?.hash,
    chainIdTextTxHash: setChainIdReceipt?.hash,
    contractTextTxHash: setContractReceipt?.hash,
  };
}
