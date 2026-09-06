/**
 * Unit tests for the entity-state reducers (reducers.ts).
 *
 * Fixtures go through the same real-ABI encode → watcher-decode path as the
 * watcher tests (via test-utils + a mocked PublicClient), so reducers are
 * exercised against decoded typed events, not hand-built objects.
 */
import { describe, expect, it } from 'vitest';
import { SECP_WRAP_ALGORITHM } from '@soulvault/protocol';
import type { Address, Hex, Log, PublicClient } from 'viem';
import { reduceAgentState, reduceDocumentState, reduceSwarmState, resolveActiveGrants } from './reducers';
import { parseDocumentEvent, SoulVaultEventWatcher } from './watcher';
import {
  ALICE,
  BOB,
  CHARLIE,
  DOC_ADDRESS,
  DOC_HASH,
  HASH,
  IDENTITY_ADDRESS,
  makeRawLog,
  SWARM,
  SWARM_ADDRESS,
  TREASURY,
  TREASURY_ADDRESS,
} from './test-utils';
import type { SoulVaultDeployment, SoulVaultDocumentEvent, SoulVaultEvent } from './types';

const SWARM_SOURCE: SoulVaultDeployment = { address: SWARM_ADDRESS, kind: 'swarm', fromBlock: 0n };
const TREASURY_SOURCE: SoulVaultDeployment = { address: TREASURY_ADDRESS, kind: 'treasury', fromBlock: 0n };
const IDENTITY_SOURCE: SoulVaultDeployment = { address: IDENTITY_ADDRESS, kind: 'identity', fromBlock: 0n };
const DOC_SOURCE: SoulVaultDeployment = { address: DOC_ADDRESS, kind: 'document', fromBlock: 0n };

/** Encode → decode through the real ABI path, same as production. */
async function decode(logs: Log[]): Promise<SoulVaultEvent[]> {
  const client = {
    getLogs: async (args: { address: Address; fromBlock: bigint; toBlock: bigint | 'latest' }) =>
      logs.filter((l) => l.address.toLowerCase() === args.address.toLowerCase()),
  };
  const watcher = new SoulVaultEventWatcher({
    publicClient: client as unknown as PublicClient,
    sources: [DOC_SOURCE, SWARM_SOURCE, TREASURY_SOURCE, IDENTITY_SOURCE],
  });
  return watcher.scanHistory();
}

async function decodeDocEvents(logs: Log[]): Promise<SoulVaultDocumentEvent[]> {
  return (await decode(logs))
    .map(parseDocumentEvent)
    .filter((e): e is SoulVaultDocumentEvent => e !== null);
}

// --- agents ---------------------------------------------------------------------

describe('reduceAgentState', () => {
  it('builds profiles through the register → update-uri → metadata lifecycle', async () => {
    const events = await decode([
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: { agentId: 1n, agentWallet: ALICE, agentURI: 'https://a.example' }, blockNumber: 1n, logIndex: 0 }),
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentURIUpdated', args: { agentId: 1n, agentWallet: ALICE, agentURI: 'https://b.example' }, blockNumber: 2n, logIndex: 0 }),
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentMetadataSet', args: { agentId: 1n, key: 'name', value: 'bot' }, blockNumber: 3n, logIndex: 0 }),
    ]);
    const { byId, byWallet } = reduceAgentState(events);
    expect(byId.size).toBe(1);
    const profile = byId.get(1n)!;
    expect(profile.uri).toBe('https://b.example');
    expect(profile.metadata).toEqual({ name: 'bot' });
    expect(profile.wallet).toBe(ALICE);
    expect(profile.registeredAt.blockNumber).toBe(1n);
    expect(profile.updatedAt.blockNumber).toBe(3n);
    expect(byWallet.get(ALICE)).toHaveLength(1);
  });

  it('indexes multiple agents per wallet', async () => {
    const events = await decode([
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: { agentId: 1n, agentWallet: ALICE, agentURI: 'https://a1' }, blockNumber: 1n, logIndex: 0 }),
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: { agentId: 2n, agentWallet: ALICE, agentURI: 'https://a2' }, blockNumber: 2n, logIndex: 0 }),
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: { agentId: 3n, agentWallet: BOB, agentURI: 'https://b1' }, blockNumber: 3n, logIndex: 0 }),
    ]);
    const { byWallet } = reduceAgentState(events);
    expect(byWallet.get(ALICE)!.map((p) => p.agentId)).toEqual([1n, 2n]);
    expect(byWallet.get(BOB)!.map((p) => p.agentId)).toEqual([3n]);
  });

  it('ignores updates for unknown agent ids (state arrives from a partial scan)', async () => {
    const events = await decode([
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentURIUpdated', args: { agentId: 99n, agentWallet: ALICE, agentURI: 'https://ghost' }, blockNumber: 1n, logIndex: 0 }),
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentMetadataSet', args: { agentId: 99n, key: 'name', value: 'ghost' }, blockNumber: 2n, logIndex: 0 }),
    ]);
    const { byId } = reduceAgentState(events);
    expect(byId.size).toBe(0);
  });

  it('does not let a duplicate AgentRegistered clobber an existing profile', async () => {
    const events = await decode([
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: { agentId: 1n, agentWallet: ALICE, agentURI: 'https://first' }, blockNumber: 1n, logIndex: 0 }),
      makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: { agentId: 1n, agentWallet: BOB, agentURI: 'https://second' }, blockNumber: 2n, logIndex: 0 }),
    ]);
    const { byId } = reduceAgentState(events);
    expect(byId.get(1n)!.wallet).toBe(ALICE);
  });
});

// --- swarm ----------------------------------------------------------------------

const joinRequest = (requestId: bigint, requester: Address, blockNumber: bigint) =>
  makeRawLog({
    kind: 'swarm', address: SWARM_ADDRESS, eventName: 'JoinRequested',
    args: { requestId, requester, pubkey: '0x1234', pubkeyRef: 'k.json', metadataRef: 'm.json' },
    blockNumber, logIndex: 0,
  });
const joinApproved = (requestId: bigint, requester: Address, epoch: bigint, blockNumber: bigint) =>
  makeRawLog({
    kind: 'swarm', address: SWARM_ADDRESS, eventName: 'JoinApproved',
    args: { requestId, requester, approver: BOB, epoch },
    blockNumber, logIndex: 0,
  });
const fundRequested = (requestId: bigint, blockNumber: bigint) =>
  makeRawLog({
    kind: 'swarm', address: SWARM_ADDRESS, eventName: 'FundRequested',
    args: { requestId, requester: ALICE, amount: 100n, reason: 'compute' },
    blockNumber, logIndex: 0,
  });

describe('reduceSwarmState', () => {
  it('walks the join lifecycle: request → approve promotes to member with pubkey', async () => {
    const events = await decode([
      joinRequest(1n, ALICE, 1n),
      joinApproved(1n, ALICE, 3n, 2n),
    ]);
    const state = reduceSwarmState(events);
    expect(state.pendingJoins.size).toBe(0);
    const member = state.members.get(ALICE)!;
    expect(member.joinedEpoch).toBe(3n);
    expect(member.pubkey).toBe('0x1234');
    expect(member.joinedAt.blockNumber).toBe(2n);
  });

  it('join rejection and cancellation clear pending requests', async () => {
    const rejected = await decode([
      joinRequest(1n, ALICE, 1n),
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'JoinRejected', args: { requestId: 1n, requester: ALICE, rejector: BOB, reason: 'no' }, blockNumber: 2n, logIndex: 0 }),
    ]);
    const cancelled = await decode([
      joinRequest(2n, ALICE, 1n),
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'JoinCancelled', args: { requestId: 2n, requester: ALICE }, blockNumber: 2n, logIndex: 0 }),
    ]);
    expect(reduceSwarmState(rejected).pendingJoins.size).toBe(0);
    expect(reduceSwarmState(cancelled).pendingJoins.size).toBe(0);
  });

  it('MemberRemoved ejects a member; re-join works', async () => {
    const events = await decode([
      joinRequest(1n, ALICE, 1n),
      joinApproved(1n, ALICE, 1n, 2n),
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'MemberRemoved', args: { member: ALICE, by: BOB, epoch: 2n }, blockNumber: 3n, logIndex: 0 }),
      joinRequest(2n, ALICE, 4n),
      joinApproved(2n, ALICE, 5n, 5n),
    ]);
    const state = reduceSwarmState(events);
    expect(state.members.get(ALICE)!.joinedEpoch).toBe(5n);
  });

  it('tracks epoch rotation, membership version, and treasury binding', async () => {
    const events = await decode([
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'EpochRotated', args: { oldEpoch: 2n, newEpoch: 3n, keyBundleRef: 'kb.json', keyBundleHash: HASH('01'), membershipVersion: 4n }, blockNumber: 1n, logIndex: 0 }),
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'TreasurySet', args: { oldTreasury: BOB, newTreasury: TREASURY, by: BOB }, blockNumber: 2n, logIndex: 0 }),
    ]);
    const state = reduceSwarmState(events);
    expect(state.currentEpoch).toBe(3n);
    expect(state.membershipVersion).toBe(4n);
    expect(state.treasury).toBe(TREASURY);
  });

  it('walks the full fund lifecycle across contracts: requested → approved → released', async () => {
    const events = await decode([
      fundRequested(1n, 1n),
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'FundRequestApproved', args: { requestId: 1n, requester: ALICE, treasury: TREASURY, amount: 100n }, blockNumber: 2n, logIndex: 0 }),
      makeRawLog({ kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundsReleased', args: { swarm: SWARM, requestId: 1n, recipient: ALICE, amount: 100n }, blockNumber: 2n, logIndex: 1 }),
    ]);
    const request = reduceSwarmState(events).fundRequests.get(1n)!;
    expect(request.status).toBe('released');
    expect(request.amount).toBe(100n);
    expect(request.updatedAt.blockNumber).toBe(2n);
  });

  it('covers the terminal fund paths: rejected, rejected-by-treasury, cancelled', async () => {
    const events = await decode([
      fundRequested(1n, 1n),
      fundRequested(2n, 2n),
      fundRequested(3n, 3n),
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'FundRequestRejected', args: { requestId: 1n, requester: ALICE, treasury: TREASURY, reason: 'no' }, blockNumber: 4n, logIndex: 0 }),
      makeRawLog({ kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundRequestRejectedByTreasury', args: { swarm: SWARM, requestId: 2n, reason: 'insufficient' }, blockNumber: 5n, logIndex: 0 }),
      makeRawLog({ kind: 'swarm', address: SWARM_ADDRESS, eventName: 'FundRequestCancelled', args: { requestId: 3n, requester: ALICE }, blockNumber: 6n, logIndex: 0 }),
    ]);
    const requests = reduceSwarmState(events).fundRequests;
    expect(requests.get(1n)!.status).toBe('rejected');
    expect(requests.get(2n)!.status).toBe('rejected-by-treasury');
    expect(requests.get(3n)!.status).toBe('cancelled');
  });

  it('ignores fund transitions for unknown request ids', async () => {
    const events = await decode([
      makeRawLog({ kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundsReleased', args: { swarm: SWARM, requestId: 42n, recipient: ALICE, amount: 1n }, blockNumber: 1n, logIndex: 0 }),
    ]);
    expect(reduceSwarmState(events).fundRequests.size).toBe(0);
  });
});

// --- documents --------------------------------------------------------------------

const publish = (docHash: Hex, blockNumber: bigint, author = ALICE) =>
  makeRawLog({
    kind: 'document', address: DOC_ADDRESS, eventName: 'DocumentPublished',
    args: { docHash, author, slotIds: ['sv_a_1', 'sv_b_1'] },
    blockNumber, logIndex: 0,
  });
const grant = (slotId: string, blockNumber: bigint, overrides: Record<string, unknown> = {}) =>
  makeRawLog({
    kind: 'document', address: DOC_ADDRESS, eventName: 'SlotKeyGranted',
    args: { docHash: DOC_HASH, slotId, recipient: CHARLIE, wrappedKey: 'AAECAw==', algorithm: SECP_WRAP_ALGORITHM, ephemeralPublicKey: '04' + 'ee'.repeat(32), nonce: '11'.repeat(12), ...overrides },
    blockNumber, logIndex: 1,
  });

describe('reduceDocumentState', () => {
  it('builds the document registry keyed by docHash', async () => {
    const { documents } = reduceDocumentState(await decode([publish(DOC_HASH, 1n)]));
    const doc = documents.get(DOC_HASH)!;
    expect(doc.author).toBe(ALICE);
    expect(doc.slotIds).toEqual(['sv_a_1', 'sv_b_1']);
    expect(doc.publishedAt.blockNumber).toBe(1n);
  });

  it('republishing the same docHash keeps the latest metadata', async () => {
    const other = HASH('bb') as Hex;
    const { documents } = reduceDocumentState(await decode([publish(DOC_HASH, 1n), publish(other, 2n, BOB)]));
    expect(documents.size).toBe(2);
    expect(documents.get(other)!.author).toBe(BOB);
  });
});

describe('resolveActiveGrants', () => {
  it('returns active grants keyed per (docHash, slot)', async () => {
    const events = await decodeDocEvents([grant('sv_a_1', 1n), grant('sv_b_1', 2n)]);
    const grants = resolveActiveGrants(events, CHARLIE);
    expect(grants.map((g) => g.slotId).sort()).toEqual(['sv_a_1', 'sv_b_1']);
    expect(grants[0].docHash).toBe(DOC_HASH);
  });

  it('last grant wins per slot and carries the newer wrap', async () => {
    const events = await decodeDocEvents([
      grant('sv_a_1', 1n, { wrappedKey: 'first==' }),
      grant('sv_a_1', 2n, { wrappedKey: 'second==' }),
    ]);
    const grants = resolveActiveGrants(events, CHARLIE);
    expect(grants).toHaveLength(1);
    expect(grants[0].wrap.wrappedKey).toBe('second==');
  });

  it('grants are scoped per document: same slot id in two docs yields two grants', async () => {
    const other = HASH('cc') as Hex;
    const events = await decodeDocEvents([
      grant('sv_a_1', 1n),
      makeRawLog({ kind: 'document', address: DOC_ADDRESS, eventName: 'SlotKeyGranted', args: { docHash: other, slotId: 'sv_a_1', recipient: CHARLIE, wrappedKey: 'other==', algorithm: SECP_WRAP_ALGORITHM, ephemeralPublicKey: '04' + 'ee'.repeat(32), nonce: '11'.repeat(12) }, blockNumber: 3n, logIndex: 1 }),
    ]);
    const grants = resolveActiveGrants(events, CHARLIE);
    expect(grants).toHaveLength(2);
    expect(grants.map((g) => g.docHash).sort()).toEqual([DOC_HASH, other].sort());
  });


  it('filters by recipient', async () => {
    const events = await decodeDocEvents([grant('sv_a_1', 1n, { recipient: BOB })]);
    expect(resolveActiveGrants(events, CHARLIE)).toHaveLength(0);
    expect(resolveActiveGrants(events, BOB)).toHaveLength(1);
  });
});
