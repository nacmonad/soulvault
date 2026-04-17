import fs from 'node:fs';
import path from 'node:path';
import { ContractFactory, type Signer, type Contract, type InterfaceAbi } from 'ethers';
import { resolveRepoRoot } from '../../src/lib/paths.js';

export type ForgeArtifact = {
  abi: InterfaceAbi;
  bytecode: string;
};

/**
 * Load a compiled Foundry artifact from `<repoRoot>/out/<name>.sol/<name>.json`.
 * Throws a clear error if the artifact is missing (usually means `forge build`
 * has not been run for this contract yet).
 */
export function loadForgeArtifact(name: string): ForgeArtifact {
  const artifactPath = path.join(resolveRepoRoot(), 'out', `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Foundry artifact not found: ${artifactPath}\n` +
        `Run \`forge build\` from the repo root first, or ensure the contract name matches its file name.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
    abi: InterfaceAbi;
    bytecode?: { object?: string };
  };
  const bytecode = raw.bytecode?.object;
  if (!bytecode || bytecode === '0x') {
    throw new Error(
      `Foundry artifact ${name} has no bytecode. Contract may be abstract or interface-only.`,
    );
  }
  return { abi: raw.abi, bytecode };
}

/**
 * Deploy a contract to the connected chain using a Foundry artifact.
 * Returns the deployed Contract instance (already awaited to tx confirmation).
 */
export async function deployContract<T extends Contract = Contract>(
  signer: Signer,
  artifact: ForgeArtifact,
  args: unknown[] = [],
): Promise<T> {
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  // Force a fresh nonce read from the provider to avoid collisions when
  // multiple Wallet instances share a private key across test files.
  const provider = signer.provider;
  const fromAddr = await signer.getAddress();
  const nonce =
    provider && 'getTransactionCount' in provider
      ? await provider.getTransactionCount(fromAddr, 'latest')
      : undefined;
  const deployArgs = nonce !== undefined ? [...args, { nonce }] : args;
  const contract = await factory.deploy(...deployArgs);
  await contract.waitForDeployment();
  return contract as unknown as T;
}
