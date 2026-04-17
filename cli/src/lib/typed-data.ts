/**
 * Canonical EIP-712 typed-data domains and action schemas for SoulVault
 * owner/admin intents. See docs/clear-signing-spec.md §4-§5.
 *
 * These schemas are the source of truth for anything that needs to be
 * displayed field-by-field on a Ledger device. Tests in
 * cli/src/lib/__integration__/*.speculos.integration.test.ts and the paired
 * hardware suites assert the same display contracts declared here.
 */

import type { TypedDataDomain, TypedDataField } from 'ethers';

/** Minimal structural type for EIP-712 payloads handled throughout SoulVault. */
export interface TypedDataPayload<T = unknown> {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  primaryType: string;
  message: T;
}

/** EIP-712 domain builders — one per protocol surface. */
export function swarmDomain(verifyingContract: string, chainId: number): TypedDataDomain {
  return { name: 'SoulVaultSwarm', version: '1', chainId, verifyingContract };
}

export function treasuryDomain(verifyingContract: string, chainId: number): TypedDataDomain {
  return { name: 'SoulVaultTreasury', version: '1', chainId, verifyingContract };
}

/** Common trailing fields every action carries. */
const REPLAY_FIELDS: TypedDataField[] = [
  { name: 'nonce', type: 'uint64' },
  { name: 'deadline', type: 'uint64' },
];

// ─── Swarm actions ────────────────────────────────────────────────────────────

export interface SetTreasuryMessage {
  swarm: string;
  treasury: string;
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildSetTreasury(
  swarmAddr: string,
  chainId: number,
  msg: SetTreasuryMessage,
): TypedDataPayload<SetTreasuryMessage> {
  return {
    domain: swarmDomain(swarmAddr, chainId),
    types: {
      SetTreasury: [
        { name: 'swarm', type: 'address' },
        { name: 'treasury', type: 'address' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'SetTreasury',
    message: msg,
  };
}

export interface RotateEpochMessage {
  swarm: string;
  fromEpoch: bigint | number;
  toEpoch: bigint | number;
  bundleManifestHash: string;
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildRotateEpoch(
  swarmAddr: string,
  chainId: number,
  msg: RotateEpochMessage,
): TypedDataPayload<RotateEpochMessage> {
  return {
    domain: swarmDomain(swarmAddr, chainId),
    types: {
      RotateEpoch: [
        { name: 'swarm', type: 'address' },
        { name: 'fromEpoch', type: 'uint64' },
        { name: 'toEpoch', type: 'uint64' },
        { name: 'bundleManifestHash', type: 'bytes32' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'RotateEpoch',
    message: msg,
  };
}

export interface ApproveJoinMessage {
  swarm: string;
  requestId: bigint | number;
  requester: string;
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildApproveJoin(
  swarmAddr: string,
  chainId: number,
  msg: ApproveJoinMessage,
): TypedDataPayload<ApproveJoinMessage> {
  return {
    domain: swarmDomain(swarmAddr, chainId),
    types: {
      ApproveJoin: [
        { name: 'swarm', type: 'address' },
        { name: 'requestId', type: 'uint256' },
        { name: 'requester', type: 'address' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'ApproveJoin',
    message: msg,
  };
}

export interface RejectJoinMessage extends ApproveJoinMessage {
  reasonHash: string;
}

export function buildRejectJoin(
  swarmAddr: string,
  chainId: number,
  msg: RejectJoinMessage,
): TypedDataPayload<RejectJoinMessage> {
  return {
    domain: swarmDomain(swarmAddr, chainId),
    types: {
      RejectJoin: [
        { name: 'swarm', type: 'address' },
        { name: 'requestId', type: 'uint256' },
        { name: 'requester', type: 'address' },
        { name: 'reasonHash', type: 'bytes32' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'RejectJoin',
    message: msg,
  };
}

export interface RemoveMemberMessage {
  swarm: string;
  member: string;
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildRemoveMember(
  swarmAddr: string,
  chainId: number,
  msg: RemoveMemberMessage,
): TypedDataPayload<RemoveMemberMessage> {
  return {
    domain: swarmDomain(swarmAddr, chainId),
    types: {
      RemoveMember: [
        { name: 'swarm', type: 'address' },
        { name: 'member', type: 'address' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'RemoveMember',
    message: msg,
  };
}

export interface BackupRequestMessage {
  swarm: string;
  epoch: bigint | number;
  trigger: string; // bytes32
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildBackupRequest(
  swarmAddr: string,
  chainId: number,
  msg: BackupRequestMessage,
): TypedDataPayload<BackupRequestMessage> {
  return {
    domain: swarmDomain(swarmAddr, chainId),
    types: {
      BackupRequest: [
        { name: 'swarm', type: 'address' },
        { name: 'epoch', type: 'uint64' },
        { name: 'trigger', type: 'bytes32' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'BackupRequest',
    message: msg,
  };
}

// ─── Treasury actions ─────────────────────────────────────────────────────────

export interface ApproveFundRequestMessage {
  swarm: string;
  requestId: bigint | number;
  amount: bigint;
  recipient: string;
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildApproveFundRequest(
  treasuryAddr: string,
  chainId: number,
  msg: ApproveFundRequestMessage,
): TypedDataPayload<ApproveFundRequestMessage> {
  return {
    domain: treasuryDomain(treasuryAddr, chainId),
    types: {
      ApproveFundRequest: [
        { name: 'swarm', type: 'address' },
        { name: 'requestId', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
        { name: 'recipient', type: 'address' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'ApproveFundRequest',
    message: msg,
  };
}

export interface RejectFundRequestMessage {
  swarm: string;
  requestId: bigint | number;
  reasonHash: string;
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildRejectFundRequest(
  treasuryAddr: string,
  chainId: number,
  msg: RejectFundRequestMessage,
): TypedDataPayload<RejectFundRequestMessage> {
  return {
    domain: treasuryDomain(treasuryAddr, chainId),
    types: {
      RejectFundRequest: [
        { name: 'swarm', type: 'address' },
        { name: 'requestId', type: 'uint256' },
        { name: 'reasonHash', type: 'bytes32' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'RejectFundRequest',
    message: msg,
  };
}

export interface TreasuryWithdrawMessage {
  treasury: string;
  recipient: string;
  amount: bigint;
  nonce: bigint | number;
  deadline: bigint | number;
}

export function buildTreasuryWithdraw(
  treasuryAddr: string,
  chainId: number,
  msg: TreasuryWithdrawMessage,
): TypedDataPayload<TreasuryWithdrawMessage> {
  return {
    domain: treasuryDomain(treasuryAddr, chainId),
    types: {
      TreasuryWithdraw: [
        { name: 'treasury', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        ...REPLAY_FIELDS,
      ],
    },
    primaryType: 'TreasuryWithdraw',
    message: msg,
  };
}

// ─── Display contracts (for test assertions) ──────────────────────────────────

/**
 * What each action is expected to show on-device, in order. Tests iterate these
 * and assert via Speculos screen API / hardware human checklist. The same
 * constant drives both suites for 1:1 parity.
 */
export interface DisplayContract {
  action: string;
  fields: Array<{
    label: string;
    /** Extracts the value string from a typed-data message (short-form for address/hash). */
    valueFrom: (msg: Record<string, unknown>) => string;
  }>;
}

const shortAddr = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`.toLowerCase();
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`.toLowerCase();
const deadlineIso = (d: bigint | number) => new Date(Number(d) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const wei = (w: bigint) => `${(Number(w) / 1e18).toFixed(6)} ETH`;

export const DISPLAY_CONTRACTS: Record<string, DisplayContract> = {
  SetTreasury: {
    action: 'Set Treasury',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'Treasury', valueFrom: (m) => shortAddr(m.treasury as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  ApproveFundRequest: {
    action: 'Approve Fund',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'Request #', valueFrom: (m) => String(m.requestId) },
      { label: 'Amount', valueFrom: (m) => wei(m.amount as bigint) },
      { label: 'Recipient', valueFrom: (m) => shortAddr(m.recipient as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  RejectFundRequest: {
    action: 'Reject Fund',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'Request #', valueFrom: (m) => String(m.requestId) },
      { label: 'Reason hash', valueFrom: (m) => shortHash(m.reasonHash as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  RotateEpoch: {
    action: 'Rotate Epoch',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'From', valueFrom: (m) => String(m.fromEpoch) },
      { label: 'To', valueFrom: (m) => String(m.toEpoch) },
      { label: 'Bundle', valueFrom: (m) => shortHash(m.bundleManifestHash as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  ApproveJoin: {
    action: 'Approve Join',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'Request #', valueFrom: (m) => String(m.requestId) },
      { label: 'Requester', valueFrom: (m) => shortAddr(m.requester as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  RejectJoin: {
    action: 'Reject Join',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'Request #', valueFrom: (m) => String(m.requestId) },
      { label: 'Requester', valueFrom: (m) => shortAddr(m.requester as string) },
      { label: 'Reason hash', valueFrom: (m) => shortHash(m.reasonHash as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  RemoveMember: {
    action: 'Remove Member',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'Member', valueFrom: (m) => shortAddr(m.member as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  BackupRequest: {
    action: 'Backup Request',
    fields: [
      { label: 'Swarm', valueFrom: (m) => shortAddr(m.swarm as string) },
      { label: 'Epoch', valueFrom: (m) => String(m.epoch) },
      { label: 'Trigger', valueFrom: (m) => shortHash(m.trigger as string) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
  TreasuryWithdraw: {
    action: 'Treasury Withdraw',
    fields: [
      { label: 'Treasury', valueFrom: (m) => shortAddr(m.treasury as string) },
      { label: 'Recipient', valueFrom: (m) => shortAddr(m.recipient as string) },
      { label: 'Amount', valueFrom: (m) => wei(m.amount as bigint) },
      { label: 'Deadline', valueFrom: (m) => deadlineIso(m.deadline as bigint) },
    ],
  },
};

/** Compute expected on-device strings for a given payload. */
export function expectedDisplay<T>(payload: TypedDataPayload<T>) {
  const contract = DISPLAY_CONTRACTS[payload.primaryType];
  if (!contract) throw new Error(`No display contract for primaryType=${payload.primaryType}`);
  return {
    action: contract.action,
    fields: contract.fields.map((f) => ({
      label: f.label,
      value: f.valueFrom(payload.message as Record<string, unknown>),
    })),
  };
}

/** Default deadline helper: `now + 15m`, unix seconds. */
export function defaultDeadline(offsetSeconds = 15 * 60): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}
