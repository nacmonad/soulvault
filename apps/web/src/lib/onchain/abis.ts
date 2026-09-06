/**
 * Event ABIs for every contract the web app listens to, in viem
 * human-readable form. This is the single source of truth for event decoding
 * in the browser; the swarm/treasury/identity fragments mirror
 * packages/node/src/swarm-contract.ts and packages/node/src/identity.ts
 * (same wire format, viem flavor), with the swarm set taken from the live
 * contract superset.
 *
 * Document events are the redaction/rehydration v0 surface
 * (docs/redaction-hydration-spec.md §3): the grant event carries the
 * SecpWrappedKey fields flattened into data, so the event IS the key delivery.
 * A delivered READ grant is a permanent capability: no revocation, no expiry
 * (spec §3).
 */
import { parseAbi, type Abi } from 'viem';
import type { SoulVaultContractKind } from './types';

export const DOCUMENT_EVENT_ABI = parseAbi([
  'event DocumentPublished(bytes32 indexed docHash, address indexed author, string[] slotIds)',
  'event SlotKeyGranted(bytes32 indexed docHash, string slotId, address indexed recipient, string wrappedKey, string algorithm, string ephemeralPublicKey, string nonce)',
]);

export const SWARM_EVENT_ABI = parseAbi([
  'event JoinRequested(uint256 indexed requestId, address indexed requester, bytes pubkey, string pubkeyRef, string metadataRef)',
  'event JoinApproved(uint256 indexed requestId, address indexed requester, address indexed approver, uint64 epoch)',
  'event JoinRejected(uint256 indexed requestId, address indexed requester, address indexed rejector, string reason)',
  'event JoinCancelled(uint256 indexed requestId, address indexed requester)',
  'event MemberRemoved(address indexed member, address indexed by, uint64 epoch)',
  'event EpochRotated(uint64 indexed oldEpoch, uint64 indexed newEpoch, string keyBundleRef, bytes32 keyBundleHash, uint64 membershipVersion)',
  'event MemberFileMappingUpdated(address indexed member, uint64 indexed epoch, string storageLocator, bytes32 merkleRoot, bytes32 publishTxHash, bytes32 manifestHash, address indexed by)',
  'event AgentMessagePosted(address indexed from, address indexed to, string topic, uint64 seq, uint64 epoch, string payloadRef, bytes32 payloadHash, uint64 ttl, uint64 timestamp)',
  'event AgentManifestUpdated(address indexed agent, string manifestRef, bytes32 manifestHash, uint64 timestamp)',
  'event BackupRequested(address indexed requestedBy, uint64 indexed epoch, string reason, string targetRef, uint64 deadline, uint64 timestamp)',
  'event HistoricalKeyBundleGranted(address indexed member, uint64 indexed epoch, string keyBundleRef, bytes32 keyBundleHash, address indexed by)',
  'event RekeyRequested(string trigger, uint64 membershipVersion)',
  'event Paused(address indexed by)',
  'event Unpaused(address indexed by)',
  'event TreasurySet(address indexed oldTreasury, address indexed newTreasury, address indexed by)',
  'event FundRequested(uint256 indexed requestId, address indexed requester, uint256 amount, string reason)',
  'event FundRequestApproved(uint256 indexed requestId, address indexed requester, address indexed treasury, uint256 amount)',
  'event FundRequestRejected(uint256 indexed requestId, address indexed requester, address indexed treasury, string reason)',
  'event FundRequestCancelled(uint256 indexed requestId, address indexed requester)',
]);

export const TREASURY_EVENT_ABI = parseAbi([
  'event FundsDeposited(address indexed from, uint256 amount)',
  'event FundsReleased(address indexed swarm, uint256 indexed requestId, address indexed recipient, uint256 amount)',
  'event FundRequestRejectedByTreasury(address indexed swarm, uint256 indexed requestId, string reason)',
  'event TreasuryWithdrawn(address indexed to, uint256 amount)',
]);

export const IDENTITY_EVENT_ABI = parseAbi([
  'event AgentRegistered(uint256 indexed agentId, address indexed agentWallet, string agentURI)',
  'event AgentURIUpdated(uint256 indexed agentId, address indexed agentWallet, string agentURI)',
  'event AgentMetadataSet(uint256 indexed agentId, string key, string value)',
]);

export const SOULVAULT_EVENT_ABIS: Record<SoulVaultContractKind, Abi> = {
  document: DOCUMENT_EVENT_ABI,
  swarm: SWARM_EVENT_ABI,
  treasury: TREASURY_EVENT_ABI,
  identity: IDENTITY_EVENT_ABI,
};
