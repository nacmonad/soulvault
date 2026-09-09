import type { Address, Hex } from "viem";

import { SOULVAULT_DEFAULT_CHAIN_ID } from "@/lib/onchain/client";

export function shortAddress(address: string) {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortTx(hash: Hex | string) {
  const value = String(hash);
  if (value.length < 16) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

export function explorerTxUrl(txHash: Hex | string, chainId = SOULVAULT_DEFAULT_CHAIN_ID) {
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
  return null;
}

export function explorerAddressUrl(address: Address | string, chainId = SOULVAULT_DEFAULT_CHAIN_ID) {
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${address}`;
  return null;
}
