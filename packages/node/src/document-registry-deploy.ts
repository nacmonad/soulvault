import fs from 'fs-extra';
import path from 'node:path';
import { Contract, ContractFactory, ZeroAddress, getAddress } from 'ethers';
import {
  createEnsSigner,
  readEnsNodeOwner,
  readEnsText,
  setAddrMultichain,
  setEnsText,
} from './ens.js';
import { getActiveOrganization } from './organization.js';
import { resolveRepoRoot } from './paths.js';

export const DEFAULT_ROOT_ENS_NAME = 'soulvault.eth';

/**
 * Default protocol root ENS name for the DocumentRegistry announce. The registry
 * is protocol-level, but in practice the "protocol root" is the operator's own
 * .eth name — so the active organization's ensName wins when set (e.g.
 * `soulvault-demo.eth`). An explicit `--root-ens-name` always wins over this.
 */
export async function resolveRootEnsName(): Promise<string> {
  const active = await getActiveOrganization();
  return active?.ensName ?? DEFAULT_ROOT_ENS_NAME;
}

const DOCUMENT_REGISTRY_ARTIFACT_PATH = path.join(
  resolveRepoRoot(),
  'out',
  'SoulVaultDocumentRegistry.sol',
  'SoulVaultDocumentRegistry.json',
);

/**
 * Discovery index for the DocumentRegistry, mirroring the `soulvault.treasuries`
 * pattern: ENSIP-11 `addr(rootNode, coinType)` is the machine-resolvable source of
 * truth (what `resolveDocumentRegistryAddress()` in apps/web reads); this text
/**
 * Discovery index for the DocumentRegistry, mirroring the `soulvault.treasuries`
 * pattern: ENSIP-11 `addr(rootNode, coinType)` is the machine-resolvable source of
 * truth (what `resolveDocumentRegistryAddress()` in apps/web reads); this text
 * record is the human/enumerable companion — a chain-keyed array that also
 * carries `deployedAtBlock` so event watchers know where to start scanning
 * (ticket 012 §A pattern).
 */
export const DOCUMENT_REGISTRY_TEXT_RECORD_KEY = 'soulvault.documentRegistry';

export type DocumentRegistryEnsRecord = {
  chainId: number;
  address: string;
  deployedAtBlock?: number;
  deployedAt?: string;
};

/**
 * Tolerant decode of the `soulvault.documentRegistry` record — empty array when
 * absent/garbage. Chain-keyed array (mirroring `soulvault.treasuries`): ERC-634
 * resolvers cannot enumerate coinTypes, so one JSON array holds one entry per
 * chain and a second-chain deploy never clobbers the first.
 */
export function parseDocumentRegistryEntries(raw: string): DocumentRegistryEnsRecord[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DocumentRegistryEnsRecord =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as DocumentRegistryEnsRecord).chainId === 'number' &&
        typeof (entry as DocumentRegistryEnsRecord).address === 'string',
    );
  } catch {
    return [];
  }
}

/** Upsert by chainId, sorted ascending. Inherits the existing entry's deployedAt/deployedAtBlock when omitted. */
export function upsertDocumentRegistryEntry(
  existing: DocumentRegistryEnsRecord[],
  entry: DocumentRegistryEnsRecord,
): DocumentRegistryEnsRecord[] {
  const prior = existing.find((e) => e.chainId === entry.chainId);
  const merged: DocumentRegistryEnsRecord = {
    chainId: entry.chainId,
    address: getAddress(entry.address),
    deployedAtBlock: entry.deployedAtBlock ?? prior?.deployedAtBlock,
    deployedAt: entry.deployedAt ?? prior?.deployedAt,
  };
  return [...existing.filter((e) => e.chainId !== entry.chainId), merged].sort(
    (a, b) => a.chainId - b.chainId,
  );
}

type Artifact = {
  abi: any[];
  bytecode: { object: string } | string;
};

async function loadDocumentRegistryArtifact(): Promise<Artifact> {
  if (!(await fs.pathExists(DOCUMENT_REGISTRY_ARTIFACT_PATH))) {
    throw new Error(
      `SoulVaultDocumentRegistry artifact not found at ${DOCUMENT_REGISTRY_ARTIFACT_PATH}. ` +
        `Run \`forge build\` from the repo root first.`,
    );
  }
  return fs.readJson(DOCUMENT_REGISTRY_ARTIFACT_PATH) as Promise<Artifact>;
}

/**
 * Deploy a fresh SoulVaultDocumentRegistry on the identity lane (Sepolia).
 * The documents lane shares the ENS lane: one public chain where authors,
 * consumers, and org panels can all listen for DocumentPublished/SlotKeyGranted
 * without swarm membership. Uses the same signer as ENS writes.
 */
export async function deployDocumentRegistryContract() {
  const signer = await createEnsSigner();
  const artifact = await loadDocumentRegistryArtifact();
  const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
  const factory = new ContractFactory(artifact.abi, bytecode, signer);
  const contract = await factory.deploy();
  const deploymentTx = contract.deploymentTransaction();
  const receipt = await deploymentTx?.wait();
  return {
    address: await contract.getAddress(),
    ownerAddress: signer.address,
    txHash: deploymentTx?.hash as string | undefined,
    blockNumber: receipt?.blockNumber as number | undefined,
  };
}

/**
 * Publish the registry address on the protocol root ENS name (v1 / ENSv1 track):
 * 1. ENSIP-11 `addr(rootNode, coinType(chainId))` — the field
 *    `resolveDocumentRegistryAddress()` reads for discovery.
 * 2. `soulvault.documentRegistry` text record — enumeration + `deployedAtBlock`
 *    so watchers can start scanning from the deploy block.
 *
 * Both writes must be signed by the root name's owner (protocol-level
 * infrastructure, not org assets). Idempotent per chain — re-running upserts.
 */
export async function announceDocumentRegistryOnEns(input: {
  rootEnsName: string;
  chainId: number;
  address: string;
  deployedAtBlock?: number;
  /** Deploy tx hash — when `deployedAtBlock` is omitted, the block is read from this tx's receipt. */
  deployedAtTxHash?: string;
}) {
  const signer = await createEnsSigner();
  let deployedAtBlock = input.deployedAtBlock;
  if (deployedAtBlock === undefined && input.deployedAtTxHash) {
    const receipt = await signer.provider?.getTransactionReceipt(input.deployedAtTxHash);
    if (!receipt) {
      throw new Error(
        `Deploy tx ${input.deployedAtTxHash} not found on the ENS-lane RPC — ` +
          `pass --deployed-at-block explicitly, or omit it (the text record will carry no scan-start block).`,
      );
    }
    deployedAtBlock = receipt.blockNumber;
  }

  const { node, owner } = await readEnsNodeOwner(input.rootEnsName);
  if (!owner || owner === ZeroAddress) {
    throw new Error(
      `ENS name "${input.rootEnsName}" is not registered (owner is zero) — nothing to announce the registry on.`,
    );
  }
  if (getAddress(owner) !== getAddress(signer.address)) {
    throw new Error(
      `Signer ${getAddress(signer.address)} does not own "${input.rootEnsName}" ` +
        `(owner is ${getAddress(owner)}). The DocumentRegistry announce must be signed ` +
        `by the root name's owner.`,
    );
  }

  const addr = await setAddrMultichain(input.rootEnsName, input.chainId, input.address);

  const existingRaw = await readEnsText(input.rootEnsName, DOCUMENT_REGISTRY_TEXT_RECORD_KEY);
  const entries = upsertDocumentRegistryEntry(parseDocumentRegistryEntries(existingRaw), {
    chainId: input.chainId,
    address: input.address,
    deployedAtBlock: input.deployedAtBlock,
    deployedAt: new Date().toISOString(),
  });
  const text = await setEnsText(
    input.rootEnsName,
    DOCUMENT_REGISTRY_TEXT_RECORD_KEY,
    JSON.stringify(entries),
  );

  return {
    node,
    coinType: addr.coinType,
    registryAddress: addr.address,
    addrTxHash: addr.txHash,
    textRecord: entries,
    textTxHash: text.txHash,
  };
}
