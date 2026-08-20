import fs from 'fs-extra';
import path from 'node:path';
import { ContractFactory, id, ZeroAddress } from 'ethers';
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

/**
 * The inverse of `bindSwarmEnsSubdomain`: blank the swarm subdomain's resolver
 * records, then release the subnode itself by zeroing its owner and resolver in the
 * registry.
 *
 * Order matters. The records are cleared while the resolver is still wired up —
 * dropping the resolver first would leave the old values sitting in the resolver
 * contract, unreachable through normal resolution but still readable by anyone who
 * computes the node hash.
 *
 * This does not, and cannot, undo disclosure. Every value written here was public on
 * a public chain, and the transaction history keeps it that way forever. What this
 * buys is that the name stops resolving going forward.
 */
export async function unbindSwarmEnsSubdomain(input: {
  organizationEnsName: string;
  swarmEnsName: string;
}) {
  const signer = await createEnsSigner();
  const registry = await getEnsRegistry(true);
  const resolver = await getPublicResolver(true);

  const orgNode = namehash(input.organizationEnsName);
  const swarmLabel = input.swarmEnsName.replace(`.${input.organizationEnsName}`, '');
  const labelhash = id(swarmLabel);
  const swarmNode = namehash(input.swarmEnsName);

  const clearAddrTx = await resolver.setAddr(swarmNode, ZeroAddress);
  const clearAddrReceipt = await clearAddrTx.wait();

  const clearChainIdTx = await resolver.setText(swarmNode, 'soulvault.chainId', '');
  const clearChainIdReceipt = await clearChainIdTx.wait();

  const clearContractTx = await resolver.setText(swarmNode, 'soulvault.swarmContract', '');
  const clearContractReceipt = await clearContractTx.wait();

  // Zeroing owner and resolver releases the subnode. The org owner can re-create it
  // later with `setSubnodeRecord`, so this is retraction, not destruction.
  const releaseTx = await registry.setSubnodeRecord(
    orgNode,
    labelhash,
    ZeroAddress,
    ZeroAddress,
    0
  );
  const releaseReceipt = await releaseTx.wait();

  return {
    node: swarmNode,
    signerAddress: signer.address,
    clearAddrTxHash: clearAddrReceipt?.hash,
    clearChainIdTextTxHash: clearChainIdReceipt?.hash,
    clearContractTextTxHash: clearContractReceipt?.hash,
    releaseSubdomainTxHash: releaseReceipt?.hash,
  };
}
