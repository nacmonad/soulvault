import { Contract, getAddress, isAddress } from 'ethers';

import { coinTypeForChain, createEnsSigner, getAddrMultichain, readEnsText } from './ens.js';
import {
  DOCUMENT_REGISTRY_TEXT_RECORD_KEY,
  parseDocumentRegistryEntries,
  resolveRootEnsName,
} from './document-registry-deploy.js';

const REGISTRY_ABI = [
  'function publishDocument(bytes32 docHash, string[] slotIds)',
  'event DocumentPublished(bytes32 indexed docHash, address indexed author, string[] slotIds)',
] as const;

/** The documents lane rides the identity lane: Sepolia (tickets 012 §A/§D). */
export const DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID = 11155111;

export type DocumentPublishInput = {
  /** 32-byte document hash — the bundle's `artifact.documentId` (with or without 0x). */
  docHash: string;
  /** Slot ids being published; must be non-empty (the contract rejects empty slots). */
  slotIds: string[];
  /** Registry address; omit to resolve via ENS discovery on the protocol root name. */
  registry?: string;
  /** Protocol root ENS name (defaults to the active organization's ensName, then soluvault.eth). */
  rootEnsName?: string;
  chainId?: number;
};

export type DocumentPublishResult = {
  registry: string;
  docHash: string;
  slotIds: string[];
  txHash: string;
  blockNumber: number | undefined;
};

/**
 * The publish target carried by a public document bundle (v0 wire format):
 * `artifact.documentId` + the redacted slot list. Extracted from the full
 * bundle shape so the CLI can accept a downloaded bundle file directly.
 */
export type PublishTargetFromBundle = { docHash: string; slotIds: string[] };

/** Pure parse of a public document bundle into the publish target. Throws with a human message. */
export function publishTargetFromBundle(raw: unknown): PublishTargetFromBundle {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Bundle is not a JSON object — expected a SoulVault public document bundle.');
  }
  const artifact = (raw as { artifact?: unknown }).artifact;
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Bundle has no artifact — is this the public bundle (not the redacted text or session file)?');
  }
  const documentId = (artifact as { documentId?: unknown }).documentId;
  const slots = (artifact as { slots?: unknown }).slots;
  if (typeof documentId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(documentId)) {
    throw new Error('Bundle artifact.documentId is missing or not a 32-byte hash.');
  }
  if (!Array.isArray(slots)) {
    throw new Error('Bundle artifact.slots is missing — re-download the public bundle from the redact page.');
  }
  const slotIds = slots
    .map((slot) => (slot && typeof slot === 'object' ? (slot as { slotId?: unknown }).slotId : undefined))
    .filter((slotId): slotId is string => typeof slotId === 'string' && slotId.length > 0);
  if (slotIds.length === 0) {
    throw new Error('Bundle has no slot ids — nothing to publish.');
  }
  return { docHash: documentId, slotIds };
}

function assertDocHash(docHash: string): string {
  if (typeof docHash !== 'string') {
    throw new Error('No document hash — pass --doc-hash or --bundle.');
  }
  const hex = docHash.startsWith('0x') ? docHash : `0x${docHash}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`--doc-hash must be a 32-byte hash, got "${docHash.slice(0, 80)}".`);
  }
  return hex;
}

function assertSlotIds(slotIds: string[]): string[] {
  const cleaned = slotIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (cleaned.length === 0) {
    throw new Error('No slot ids to publish — pass --slot-id (repeatable) or --bundle.');
  }
  const unique = [...new Set(cleaned)];
  if (unique.length !== cleaned.length) {
    throw new Error('Duplicate slot ids in the publish list — each slot must appear once.');
  }
  return unique;
}

/**
 * Resolve the DocumentRegistry address the same way the dashboard does:
 * ENSIP-11 `addr(rootName, coinType(chainId))` first, then the
 * `soulvault.documentRegistry` text record's entry for the chain.
 */
export async function resolveDocumentRegistryAddress(input: {
  rootEnsName?: string;
  chainId?: number;
} = {}): Promise<string> {
  const rootEnsName = input.rootEnsName ?? (await resolveRootEnsName());
  const chainId = input.chainId ?? DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID;
  const addr = await getAddrMultichain(rootEnsName, chainId);
  if (addr && isAddress(addr)) return getAddress(addr);
  // Text-record fallback: the addr() read needs an ENSIP-11-capable resolver;
  // the text record also carries the address and is written alongside it.
  const raw = await readEnsText(rootEnsName, DOCUMENT_REGISTRY_TEXT_RECORD_KEY);
  const entry = parseDocumentRegistryEntries(raw).find((entry) => entry.chainId === chainId);
  if (entry) return getAddress(entry.address);
  throw new Error(
    `No DocumentRegistry announced on "${rootEnsName}" for chain ${chainId} ` +
      `(coinType ${coinTypeForChain(chainId)}). Deploy one first: ` +
      `\`pnpm soulvault document deploy-registry --root-ens-name ${rootEnsName}\`, ` +
      `or pass --registry explicitly.`,
  );
}

/**
 * Anchor a redacted document on the DocumentRegistry (identity lane signer —
 * same wallet that owns the root ENS name / published the document):
 * `publishDocument(docHash, slotIds)` → `DocumentPublished`. Idempotent for the
 * same author (the contract allows republishing your own docHash), so a failed
 * confirmation can be retried without burning a second publication.
 */
export async function publishDocumentOnRegistry(input: DocumentPublishInput): Promise<DocumentPublishResult> {
  const docHash = assertDocHash(input.docHash);
  const slotIds = assertSlotIds(input.slotIds);
  const registry = input.registry
    ? getAddress(input.registry)
    : await resolveDocumentRegistryAddress({ rootEnsName: input.rootEnsName, chainId: input.chainId });

  const signer = await createEnsSigner();
  const contract = new Contract(registry, REGISTRY_ABI, signer);
  const tx = await contract.publishDocument(docHash, slotIds);
  const receipt = await tx.wait();
  return {
    registry,
    docHash,
    slotIds,
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber,
  };
}
