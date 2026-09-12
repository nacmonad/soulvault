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
  /** Which chain the contract lives on. Undefined = the watcher's own chain
   * (env-era sources predate multi-chain sources). The events provider drops
   * sources on other chains — one watcher per chain today. */
  chainId?: number;
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
  /** The grant event IS the key delivery (spec §3, v0). A delivered READ
   * grant is a permanent capability — no revocation, no expiry. */
  wrap: SecpWrappedKey;
};

/** A consumer's onchain request for hydration (registry `requestRehydration`).
 * The tx signature binds `recipient` (msg.sender) to `rehydrationPublicKey`,
 * so the event is the wallet-attested key binding — the author wraps grants
 * straight from it, no out-of-band attestation exchange. */
export type RehydrationRequestedEvent = EventMeta & {
  eventName: 'RehydrationRequested';
  docHash: Hex;
  recipient: Address;
  /** Uncompressed secp256k1 public key (hex), the grant-wrap target. */
  rehydrationPublicKey: string;
};

export type SoulVaultDocumentEvent =
  | DocumentPublishedEvent
  | SlotKeyGrantedEvent
  | RehydrationRequestedEvent;

export type SoulVaultEvent = GenericContractEvent | SoulVaultDocumentEvent;

export type ActiveGrant = {
  docHash: Hex;
  slotId: string;
  recipient: Address;
  wrap: SecpWrappedKey;
  grantedAt: { blockNumber: bigint; txHash: Hex };
};
