/**
 * CLI-side rehydration lane: onchain rehydration requests, slot-key grants,
 * and grant-based document rehydration against the SoulVaultDocumentRegistry.
 *
 * This is the terminal twin of the dashboard's grants/rehydrate pages:
 * - A recipient requests hydration (`requestRehydration`) — the tx signature
 *   binds msg.sender to the rehydration public key, so the event log is the
 *   wallet-attested key binding (no EIP-712 paste needed on this path).
 * - The author lists pending requests, wraps slot keys to the requested
 *   pubkey (`createSlotKeyGrantsForRecipient`), and delivers them via
 *   `grantSlotKey` — one tx per slot, only from the publishing author.
 * - The recipient pulls `SlotKeyGranted` events back, unwraps with the local
 *   rehydration key, and rehydrates the granted slots (partial by design —
 *   ungranted slots keep their {{sv:…}} markers).
 *
 * Rehydration keys persist under `~/.soulvault/keys/rehydration-<keyId>.json`
 * (0600) so an agent can request/rehydrate across restarts without re-attesting.
 */
import fs from 'fs-extra';
import { Contract, EventLog, getAddress } from 'ethers';import {
  SECP_WRAP_ALGORITHM,
  createSlotKeyGrantsForRecipient,
  loadOrCreateRehydrationKey,
  parsePublicDocumentBundle,
  rehydrateGrantedDocument,
  type PublicDocumentBundle,
  type RehydrationKey,
  type RehydrationKeyStore,
  type SlotKeyGrant,
} from '@soulvault/protocol';
import { createEnsProvider, createEnsSigner } from './ens.js';
import {
  DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID,
  resolveDocumentRegistryAddress,
} from './document-registry.js';
import { resolveKeysDir } from './paths.js';

/** ABI slice for the rehydration/grant lane (registry deploys verbatim per repo). */
export const DOCUMENT_REGISTRY_REHYDRATION_ABI = [
  'function grantSlotKey(bytes32 docHash, string slotId, address recipient, string wrappedKey, string algorithm, string ephemeralPublicKey, string nonce)',
  'function requestRehydration(bytes32 docHash, string rehydrationPublicKey)',
  'function requestRehydration(bytes32 docHash, string rehydrationPublicKey, string selfieProof)',
  'function publicationAuthor(bytes32 docHash) view returns (address)',
  'function selfieRequired(bytes32 docHash) view returns (bool)',
  'event DocumentPublished(bytes32 indexed docHash, address indexed author, string[] slotIds, bool selfieRequired)',
  'event RehydrationRequested(bytes32 indexed docHash, address indexed recipient, string rehydrationPublicKey, string selfieProof)',
  'event SlotKeyGranted(bytes32 indexed docHash, string slotId, address indexed recipient, string wrappedKey, string algorithm, string ephemeralPublicKey, string nonce)',
] as const;

export type RehydrationRequestRecord = {
  docHash: string;
  recipient: string;
  rehydrationPublicKey: string;
  selfieProof: string;
  txHash: string;
  blockNumber: number;
};

export type SlotKeyGrantRecord = {
  docHash: string;
  slotId: string;
  recipient: string;
  wrap: { algorithm: string; wrappedKey: string; ephemeralPublicKey: string; nonce: string };
  txHash: string;
  blockNumber: number;
};

/** File-backed RehydrationKeyStore under the CLI keys dir (0600). */
class FileRehydrationKeyStore implements RehydrationKeyStore {
  constructor(readonly path: string) {}

  async get(keyId: string): Promise<string | null> {
    if (!(await fs.pathExists(this.path))) return null;
    const record = await fs.readJson(this.path) as { keyId?: string; privateKey?: string };
    if (record.keyId !== keyId || typeof record.privateKey !== 'string') return null;
    return record.privateKey;
  }

  async set(keyId: string, privateKeyHex: string): Promise<void> {
    await fs.ensureDir(resolveKeysDir());
    const record = { keyId, privateKey: privateKeyHex, createdAt: new Date().toISOString() };
    await fs.writeJson(this.path, record, { spaces: 2, mode: 0o600 });
    await fs.chmod(this.path, 0o600);
  }

  async remove(keyId: string): Promise<void> {
    if (!(await fs.pathExists(this.path))) return;
    const record = await fs.readJson(this.path) as { keyId?: string };
    if (record.keyId === keyId) await fs.remove(this.path);
  }
}

function rehydrationKeyPath(keyId: string): string {
  // keyId is 'default' or a caller-chosen slug; keep it filename-safe.
  const safe = keyId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${resolveKeysDir()}/rehydration-${safe}.json`;
}

/**
 * Load (or lazily create) the local rehydration key for this wallet. The same
 * key is reused across requests — re-requesting with a fresh key is only for
 * the key-loss recovery path (loadOrCreateRehydrationKey with replace: true).
 */
export async function loadLocalRehydrationKey(keyId = 'default', replace = false) {
  return loadOrCreateRehydrationKey({
    store: new FileRehydrationKeyStore(rehydrationKeyPath(keyId)),
    keyId,
    replace,
  });
}

async function resolveRegistryOr(input: {
  registry?: string;
  rootEnsName?: string;
  chainId?: number;
}): Promise<string> {
  if (input.registry) return getAddress(input.registry);
  return resolveDocumentRegistryAddress({
    rootEnsName: input.rootEnsName,
    chainId: input.chainId,
  });
}

/**
 * Ask for hydration of a published document: `requestRehydration(docHash, pubkey)`.
 * The signer is the recipient; its tx signature is the wallet↔pubkey attestation.
 */
export async function requestRehydrationOnRegistry(input: {
  docHash: string;
  rehydrationPublicKey?: string;
  selfieProof?: string;
  keyId?: string;
  replaceKey?: boolean;
  registry?: string;
  rootEnsName?: string;
  chainId?: number;
}) {
  const chainId = input.chainId ?? DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID;
  const registry = await resolveRegistryOr(input);
  const key = await loadLocalRehydrationKey(input.keyId ?? 'default', input.replaceKey ?? false);
  const docHash = normalizeDocHash(input.docHash);
  const selfieProof = input.selfieProof ?? '';

  const signer = await createEnsSigner();
  const contract = new Contract(registry, DOCUMENT_REGISTRY_REHYDRATION_ABI, signer);
  const tx = selfieProof
    ? await contract['requestRehydration(bytes32,string,string)'](docHash, key.publicKey, selfieProof)
    : await contract['requestRehydration(bytes32,string)'](docHash, key.publicKey);
  const receipt = await tx.wait();
  return {
    registry,
    docHash,
    recipient: signer.address,
    rehydrationPublicKey: key.publicKey,
    rehydrationKeyFingerprint: key.fingerprint,
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber,
  };
}

function normalizeDocHash(docHash: string): string {
  const hex = docHash.startsWith('0x') ? docHash : `0x${docHash}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`--doc-hash must be a 32-byte hash, got "${docHash.slice(0, 80)}".`);
  }
  return hex;
}

/** Parse a CLI `--slot-key slotId=hex` pair. Throws with the expected shape. */
export function parseSlotKeyPair(pair: string): { slotId: string; key: string } {
  const eq = pair.indexOf('=');
  const slotId = eq > 0 ? pair.slice(0, eq).trim() : '';
  const key = eq > 0 ? pair.slice(eq + 1).trim() : '';
  if (!slotId || !key) {
    throw new Error(`--slot-key expects slotId=hex, got "${pair}"`);
  }
  return { slotId, key };
}

/** Accept the public bundle as a serialized JSON string or a parsed object. */
export function normalizeBundleInput(bundle: unknown): ReturnType<typeof parsePublicDocumentBundle> {
  return typeof bundle === 'string' ? parsePublicDocumentBundle(bundle) : (bundle as ReturnType<typeof parsePublicDocumentBundle>);
}

/**
 * Read `RehydrationRequested` events — the author's to-do list for grants.
 * Filter by docHash and/or recipient; `fromBlock` defaults to a recent window
 * (public RPCs reject unbounded historic scans).
 */
export async function fetchRehydrationRequests(input: {
  docHash?: string;
  recipient?: string;
  registry?: string;
  rootEnsName?: string;
  chainId?: number;
  fromBlock?: number;
  toBlock?: number | 'latest';
} = {}): Promise<RehydrationRequestRecord[]> {
  const chainId = input.chainId ?? DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID;
  const registry = await resolveRegistryOr(input);
  const provider = await createEnsProvider();
  const contract = new Contract(registry, DOCUMENT_REGISTRY_REHYDRATION_ABI, provider);

  const filter = contract.filters.RehydrationRequested(
    input.docHash ? normalizeDocHash(input.docHash) : undefined,
    input.recipient ? getAddress(input.recipient) : undefined,
  );
  const events = await contract.queryFilter(filter, input.fromBlock, input.toBlock ?? 'latest');
  return events.map((event) => {
    const args = (event as EventLog).args as unknown as {
      docHash: string;
      recipient: string;
      rehydrationPublicKey: string;
      selfieProof?: string;
    };
    return {
      docHash: args.docHash,
      recipient: args.recipient,
      rehydrationPublicKey: args.rehydrationPublicKey,
      selfieProof: args.selfieProof ?? '',
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
    };
  });
}

/**
 * Read `SlotKeyGranted` events — what a recipient can actually unwrap.
 * The permanent capability log (spec §3): no revoke, no expiry in v0.
 */
export async function fetchSlotKeyGrants(input: {
  docHash?: string;
  recipient?: string;
  slotId?: string;
  registry?: string;
  rootEnsName?: string;
  chainId?: number;
  fromBlock?: number;
  toBlock?: number | 'latest';
} = {}): Promise<SlotKeyGrantRecord[]> {
  const chainId = input.chainId ?? DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID;
  const registry = await resolveRegistryOr(input);
  const provider = await createEnsProvider();
  const contract = new Contract(registry, DOCUMENT_REGISTRY_REHYDRATION_ABI, provider);

  const filter = contract.filters.SlotKeyGranted(
    input.docHash ? normalizeDocHash(input.docHash) : undefined,
    input.slotId,
    input.recipient ? getAddress(input.recipient) : undefined,
  );
  const events = await contract.queryFilter(filter, input.fromBlock, input.toBlock ?? 'latest');
  const records = events.map((event) => {
    const args = (event as EventLog).args as unknown as {
      docHash: string;
      slotId: string;
      recipient: string;
      algorithm: string;
      wrappedKey: string;
      ephemeralPublicKey: string;
      nonce: string;
    };
    return {
      docHash: args.docHash,
      slotId: args.slotId,
      recipient: args.recipient,
      wrap: {
        algorithm: args.algorithm as typeof SECP_WRAP_ALGORITHM,
        wrappedKey: args.wrappedKey,
        ephemeralPublicKey: args.ephemeralPublicKey,
        nonce: args.nonce,
      },
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
    };
  });
  return recordsSorted(records);
}

/**
 * Author side: wrap slot keys to the recipient's rehydration public key and
 * deliver them via `grantSlotKey`. Reads the latest `RehydrationRequested`
 * event for the recipient when no explicit pubkey is passed (the onchain
 * request path — no attestation file needed). One tx per slot (v0 contract
 * shape); signing costs dominate, so keep slot lists short.
 */
export async function grantSlotKeysOnRegistry(input: {
  docHash: string;
  slotIds: string[];
  recipient: string;
  recipientPublicKey?: string;
  slotKeys: { slotId: string; key: string }[];
  registry?: string;
  rootEnsName?: string;
  chainId?: number;
}) {
  const chainId = input.chainId ?? DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID;
  const registry = await resolveRegistryOr(input);
  const docHash = normalizeDocHash(input.docHash);
  const recipient = getAddress(input.recipient);

  let recipientPublicKey = input.recipientPublicKey;
  if (!recipientPublicKey) {
    const requests = await fetchRehydrationRequests({
      docHash,
      recipient,
      registry,
      chainId,
      fromBlock: 0,
    });
    if (requests.length === 0) {
      throw new Error(
        `No RehydrationRequested event from ${recipient} for ${docHash.slice(0, 18)}… — ` +
          `the recipient must request first (or pass --recipient-public-key explicitly).`,
      );
    }
    recipientPublicKey = requests[requests.length - 1].rehydrationPublicKey;
  }

  const grants = createSlotKeyGrantsForRecipient({
    slotKeys: input.slotKeys,
    slotIds: input.slotIds,
    recipient,
    recipientPublicKey,
  });

  const signer = await createEnsSigner();
  const contract = new Contract(registry, DOCUMENT_REGISTRY_REHYDRATION_ABI, signer);
  const results: { slotId: string; txHash: string; blockNumber?: number }[] = [];
  for (const grant of grants) {
    const tx = await contract.grantSlotKey(
      docHash,
      grant.slotId,
      grant.recipient,
      grant.wrap.wrappedKey,
      grant.wrap.algorithm,
      grant.wrap.ephemeralPublicKey,
      grant.wrap.nonce,
    );
    const receipt = await tx.wait();
    results.push({ slotId: grant.slotId, txHash: tx.hash, blockNumber: receipt?.blockNumber });
  }
  return { registry, docHash, recipient, grants: results };
}

/**
 * Recipient side: pull `SlotKeyGranted` events for this wallet from the
 * registry, unwrap with the local rehydration key, and rehydrate the granted
 * slots of the bundle (partial by design — ungranted slots stay {{sv:…}}).
 * Accepts the public bundle as a parsed object or a serialized JSON string.
 */
export async function rehydrateFromChain(input: {
  bundle: unknown | string;
  docHash?: string;
  recipient?: string;
  slotId?: string;
  rehydrationKey?: RehydrationKey;
  keyId?: string;
  registry?: string;
  rootEnsName?: string;
  chainId?: number;
  fromBlock?: number;
  toBlock?: number | 'latest';
}) {
  const bundle = normalizeBundleInput(input.bundle);
  const chainId = input.chainId ?? DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID;
  const registry = await resolveRegistryOr(input);
  const key = input.rehydrationKey ?? (await loadLocalRehydrationKey(input.keyId ?? 'default'));

  const signer = await createEnsSigner();
  const recipient = input.recipient ? getAddress(input.recipient) : signer.address;
  const grants = await fetchSlotKeyGrants({
    docHash: input.docHash,
    recipient,
    registry,
    chainId,
    fromBlock: input.fromBlock,
    toBlock: input.toBlock,
  });
  if (grants.length === 0) {
    throw new Error(
      `No SlotKeyGranted events for ${recipient} on ${registry} — the author has not granted any slots yet.`,
    );
  }

  const grantInputs = grants.map((grant) => ({
    slotId: grant.slotId,
    recipient: grant.recipient,
    recipientKeyFingerprint: key.fingerprint,
    wrap: {
      algorithm: grant.wrap.algorithm as typeof SECP_WRAP_ALGORITHM,
      wrappedKey: grant.wrap.wrappedKey,
      ephemeralPublicKey: grant.wrap.ephemeralPublicKey,
      nonce: grant.wrap.nonce,
    },
  }));
  const document = rehydrateGrantedDocument({
    artifact: bundle.artifact,
    encryptedSlots: bundle.encryptedSlots,
    grants: grantInputs,
    recipientWallet: recipient,
    rehydrationKey: key,
  });
  return {
    registry,
    recipient,
    grantedSlotIds: grants.map((grant) => grant.slotId),
    document,
  };
}

function recordsSorted<T extends { blockNumber: number }>(records: T[]): T[] {
  return [...records].sort((a, b) => a.blockNumber - b.blockNumber);
}
