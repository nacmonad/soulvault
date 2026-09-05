/**
 * Shared onchain types for the browser event layer.
 *
 * Wire types for wrapped keys come from @soulvault/protocol and must not be
 * redefined here — see packages/protocol/src/crypto.ts for the compat contract.
 */
import type { SecpWrappedKey } from '@soulvault/protocol';
import type { Address, Hex } from 'viem';

export type SoulVaultContractKind = 'document' | 'swarm' | 'treasury' | 'identity';

export type SoulVaultDeployment = {
  address: Address;
  kind: SoulVaultContractKind;
  fromBlock: bigint;
  label?: string;
};

export type EventMeta = {
  /** Which contract emitted this (deployment source). */
  source: Address;
  sourceKind: SoulVaultContractKind;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
};

/** Any event we did not narrow into a dedicated type. */
export type GenericContractEvent = EventMeta & {
  eventName: string;
  args: Record<string, unknown>;
};

export type DocumentPublishedEvent = EventMeta & {
  eventName: 'DocumentPublished';
  docHash: Hex;
  author: Address;
  slotIds: string[];
};

export type SlotKeyGrantedEvent = EventMeta & {
  eventName: 'SlotKeyGranted';
  docHash: Hex;
  slotId: string;
  recipient: Address;
  /** The grant event IS the key delivery (spec §3, v0). */
  wrap: SecpWrappedKey;
  /** Unix seconds. null = no expiry (contract emits 0 for "never"). */
  expiry: bigint | null;
};

export type SlotRevokedEvent = EventMeta & {
  eventName: 'SlotRevoked';
  docHash: Hex;
  slotId: string;
  recipient: Address;
  by: Address;
};

export type SoulVaultDocumentEvent =
  | DocumentPublishedEvent
  | SlotKeyGrantedEvent
  | SlotRevokedEvent;

export type SoulVaultEvent = GenericContractEvent | SoulVaultDocumentEvent;

export type ActiveGrant = {
  docHash: Hex;
  slotId: string;
  recipient: Address;
  wrap: SecpWrappedKey;
  expiry: bigint | null;
  grantedAt: { blockNumber: bigint; txHash: Hex };
};
