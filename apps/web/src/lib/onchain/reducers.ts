/**
 * Pure entity-state reducers over the decoded event stream.
 *
 * The provider caches raw, ordered events; these functions collapse that log
 * into derived state (agent profiles, swarm membership, fund request
 * lifecycle, document registry, active grants). All reducers assume nothing
 * about input order — they sort by (blockNumber, logIndex) themselves — and
 * never mutate their input.
 *
 * The watcher's resolveGrants uses resolveActiveGrants, so grant semantics
 * (last-grant-wins, revoke clears, re-grant reactivates, expiry) are defined
 * in exactly one place.
 */
import { isAddressEqual, type Address, type Hex } from 'viem';
import type { ActiveGrant, SoulVaultDocumentEvent, SoulVaultEvent } from './types';

export function orderEvents<T extends SoulVaultEvent>(events: readonly T[]): T[] {
  return [...events].sort(
    (a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex,
  );
}

const at = (event: SoulVaultEvent) => ({ blockNumber: event.blockNumber, txHash: event.txHash });

function argsOf(event: SoulVaultEvent): Record<string, unknown> {
  if ('args' in event) return event.args;
  return {} as Record<string, unknown>;
}

// --- agents (ERC-8004 identity) ------------------------------------------------

export type AgentProfile = {
  agentId: bigint;
  wallet: Address;
  uri: string | null;
  metadata: Record<string, string>;
  registeredAt: { blockNumber: bigint; txHash: Hex };
  updatedAt: { blockNumber: bigint; txHash: Hex };
};

export type AgentDirectory = {
  byId: Map<bigint, AgentProfile>;
  byWallet: Map<Address, AgentProfile[]>;
};

export function reduceAgentState(events: readonly SoulVaultEvent[]): AgentDirectory {
  const byId = new Map<bigint, AgentProfile>();
  for (const event of orderEvents(events)) {
    if (event.sourceKind !== 'identity') continue;
    const args = argsOf(event);
    const agentId = args.agentId as bigint;
    switch (event.eventName) {
      case 'AgentRegistered': {
        if (byId.has(agentId)) break;
        byId.set(agentId, {
          agentId,
          wallet: args.agentWallet as Address,
          uri: (args.agentURI as string) ?? null,
          metadata: {},
          registeredAt: at(event),
          updatedAt: at(event),
        });
        break;
      }
      case 'AgentURIUpdated': {
        const profile = byId.get(agentId);
        if (!profile) break;
        profile.uri = (args.agentURI as string) ?? null;
        profile.updatedAt = at(event);
        break;
      }
      case 'AgentMetadataSet': {
        const profile = byId.get(agentId);
        if (!profile) break;
        profile.metadata[args.key as string] = args.value as string;
        profile.updatedAt = at(event);
        break;
      }
    }
  }
  const byWallet = new Map<Address, AgentProfile[]>();
  for (const profile of byId.values()) {
    const list = byWallet.get(profile.wallet) ?? [];
    list.push(profile);
    byWallet.set(profile.wallet, list);
  }
  return { byId, byWallet };
}

// --- swarm (membership, epochs, treasury binding, fund lifecycle) ---------------

export type SwarmMember = {
  wallet: Address;
  joinedEpoch: bigint;
  pubkey: Hex | null;
  joinedAt: { blockNumber: bigint; txHash: Hex };
};

export type PendingJoinRequest = {
  requestId: bigint;
  requester: Address;
  pubkey: Hex | null;
  pubkeyRef: string | null;
  metadataRef: string | null;
  requestedAt: { blockNumber: bigint; txHash: Hex };
};

export type FundRequestStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'rejected-by-treasury'
  | 'released';

export type SwarmFundRequest = {
  requestId: bigint;
  requester: Address;
  amount: bigint;
  reason: string | null;
  status: FundRequestStatus;
  updatedAt: { blockNumber: bigint; txHash: Hex };
};

export type SwarmState = {
  members: Map<Address, SwarmMember>;
  pendingJoins: Map<bigint, PendingJoinRequest>;
  treasury: Address | null;
  currentEpoch: bigint | null;
  membershipVersion: bigint | null;
  fundRequests: Map<bigint, SwarmFundRequest>;
};

export function reduceSwarmState(events: readonly SoulVaultEvent[]): SwarmState {
  const state: SwarmState = {
    members: new Map(),
    pendingJoins: new Map(),
    treasury: null,
    currentEpoch: null,
    membershipVersion: null,
    fundRequests: new Map(),
  };
  for (const event of orderEvents(events)) {
    const kind = event.sourceKind;
    if (kind !== 'swarm' && kind !== 'treasury') continue;
    const args = argsOf(event);
    const position = at(event);
    switch (event.eventName) {
      case 'JoinRequested': {
        state.pendingJoins.set(args.requestId as bigint, {
          requestId: args.requestId as bigint,
          requester: args.requester as Address,
          pubkey: (args.pubkey as Hex) || null,
          pubkeyRef: (args.pubkeyRef as string) ?? null,
          metadataRef: (args.metadataRef as string) ?? null,
          requestedAt: position,
        });
        break;
      }
      case 'JoinApproved': {
        const requester = args.requester as Address;
        const request = [...state.pendingJoins.values()].find(
          (r) => isAddressEqual(r.requester, requester),
        );
        state.pendingJoins.delete(request?.requestId ?? BigInt(-1));
        state.members.set(requester, {
          wallet: requester,
          joinedEpoch: args.epoch as bigint,
          pubkey: request?.pubkey ?? null,
          joinedAt: position,
        });
        break;
      }
      case 'JoinRejected':
      case 'JoinCancelled': {
        const requester = args.requester as Address;
        for (const [id, request] of state.pendingJoins) {
          if (isAddressEqual(request.requester, requester)) state.pendingJoins.delete(id);
        }
        break;
      }
      case 'MemberRemoved': {
        state.members.delete(args.member as Address);
        break;
      }
      case 'EpochRotated': {
        state.currentEpoch = args.newEpoch as bigint;
        state.membershipVersion = args.membershipVersion as bigint;
        break;
      }
      case 'TreasurySet': {
        state.treasury = args.newTreasury as Address;
        break;
      }
      case 'FundRequested': {
        state.fundRequests.set(args.requestId as bigint, {
          requestId: args.requestId as bigint,
          requester: args.requester as Address,
          amount: args.amount as bigint,
          reason: (args.reason as string) ?? null,
          status: 'requested',
          updatedAt: position,
        });
        break;
      }
      case 'FundRequestApproved': {
        const request = state.fundRequests.get(args.requestId as bigint);
        if (request) {
          request.status = 'approved';
          request.updatedAt = position;
        }
        break;
      }
      case 'FundRequestRejected': {
        const request = state.fundRequests.get(args.requestId as bigint);
        if (request) {
          request.status = 'rejected';
          request.updatedAt = position;
        }
        break;
      }
      case 'FundRequestCancelled': {
        const request = state.fundRequests.get(args.requestId as bigint);
        if (request) {
          request.status = 'cancelled';
          request.updatedAt = position;
        }
        break;
      }
      case 'FundRequestRejectedByTreasury': {
        const request = state.fundRequests.get(args.requestId as bigint);
        if (request) {
          request.status = 'rejected-by-treasury';
          request.updatedAt = position;
        }
        break;
      }
      case 'FundsReleased': {
        const request = state.fundRequests.get(args.requestId as bigint);
        if (request) {
          request.status = 'released';
          request.updatedAt = position;
        }
        break;
      }
    }
  }
  return state;
}

// --- documents (publish registry + grants) --------------------------------------

export type DocumentMeta = {
  docHash: Hex;
  author: Address;
  slotIds: string[];
  publishedAt: { blockNumber: bigint; txHash: Hex };
};

export type DocumentState = {
  documents: Map<Hex, DocumentMeta>;
};

export function reduceDocumentState(events: readonly SoulVaultEvent[]): DocumentState {
  const documents = new Map<Hex, DocumentMeta>();
  for (const event of orderEvents(events)) {
    if (event.sourceKind !== 'document' || event.eventName !== 'DocumentPublished') continue;
    const published = event as SoulVaultDocumentEvent & { eventName: 'DocumentPublished' };
    documents.set(published.docHash, {
      docHash: published.docHash,
      author: published.author,
      slotIds: published.slotIds,
      publishedAt: at(event),
    });
  }
  return { documents };
}

/**
 * Active grants for a recipient across all documents, from already-narrowed
 * document events. Semantics: last grant wins per (docHash, slotId);
 * SlotRevoked clears; a later re-grant reactivates; expired grants drop out.
 *
 * Honest READ-mode semantics: this only stops future unwraps — plaintext
 * already decrypted is unrecoverable (spec §3).
 */
export function resolveActiveGrants(
  docEvents: readonly SoulVaultDocumentEvent[],
  recipient: Address,
  options?: { now?: bigint },
): ActiveGrant[] {
  const slots = new Map<string, ActiveGrant | null>();
  for (const event of orderEvents(docEvents)) {
    if (event.eventName === 'DocumentPublished') continue;
    if (!isAddressEqual(event.recipient, recipient)) continue;
    if (event.eventName === 'SlotKeyGranted') {
      slots.set(`${event.docHash}:${event.slotId}`, {
        docHash: event.docHash,
        slotId: event.slotId,
        recipient: event.recipient,
        wrap: event.wrap,
        expiry: event.expiry,
        grantedAt: { blockNumber: event.blockNumber, txHash: event.txHash },
      });
    } else {
      slots.set(`${event.docHash}:${event.slotId}`, null);
    }
  }
  const now = options?.now ?? BigInt(Math.floor(Date.now() / 1000));
  const active: ActiveGrant[] = [];
  for (const grant of slots.values()) {
    if (grant === null) continue;
    if (grant.expiry !== null && grant.expiry <= now) continue;
    active.push(grant);
  }
  return active;
}
