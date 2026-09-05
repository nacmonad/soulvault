/**
 * Shared ABI-encoding fixtures for event-layer tests. Builds raw logs with
 * viem's own encodeEventTopics + encodeAbiParameters against the same
 * parseAbi fragments the watcher decodes with, so fixtures exercise the real
 * ABI path (topic ordering, data layout) rather than hand-written hex.
 */
import { encodeAbiParameters, encodeEventTopics, getAddress, getAbiItem, type AbiEvent, type Address, type Hex, type Log } from 'viem';
import { SOULVAULT_EVENT_ABIS } from './abis';
import type { SoulVaultContractKind } from './types';

// viem decodes addresses checksummed, so normalize the fixtures the same way
export const ALICE = getAddress('0x00000000000000000000000000000000000000a1');
export const BOB = getAddress('0x00000000000000000000000000000000000000b2');
export const CHARLIE = getAddress('0x00000000000000000000000000000000000000c3');
export const TREASURY = getAddress('0x00000000000000000000000000000000000000d4');
export const SWARM = getAddress('0x00000000000000000000000000000000000000e5');

export const DOC_ADDRESS = '0x000000000000000000000000000000000001d0c1' as Address;
export const SWARM_ADDRESS = '0x000000000000000000000000000000000001d0c2' as Address;
export const TREASURY_ADDRESS = '0x000000000000000000000000000000000001d0c3' as Address;
export const IDENTITY_ADDRESS = '0x000000000000000000000000000000000001d0c4' as Address;

export const DOC_HASH = ('0x' + 'aa'.repeat(32)) as Hex;
export const HASH = (seed: string) => ('0x' + seed.repeat(32)) as Hex;

export function makeRawLog(input: {
  kind: SoulVaultContractKind;
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  txHash?: Hex;
}): Log {
  const abi = SOULVAULT_EVENT_ABIS[input.kind];
  const event = getAbiItem({ abi, name: input.eventName as never }) as AbiEvent;
  const topics = encodeEventTopics({ abi, eventName: input.eventName as never, args: input.args as never });
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const values = nonIndexed.map((i) => input.args[i.name!]);
  const data = nonIndexed.length > 0 ? encodeAbiParameters(nonIndexed, values as never) : ('0x' as Hex);
  return {
    address: input.address,
    topics,
    data,
    blockNumber: input.blockNumber,
    logIndex: input.logIndex,
    transactionHash: input.txHash ?? HASH('ab'),
    removed: false,
  } as unknown as Log;
}
