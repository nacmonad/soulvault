/**
 * EIP-1193 injected provider backed by a Foundry Anvil node + local key.
 * Chain reads and broadcasts go to Anvil; the wallet never touches
 * WalletConnect. For tests and NEXT_PUBLIC_SOULVAULT_FOUNDRY_PROVIDER=1.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { foundry, sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/** Anvil account[0] — well-known test key, never use on a live network. */
export const ANVIL_ACCOUNT0 = {
  address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
  privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
};

export type FoundryProvider = {
  isFoundry: true;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export function createFoundryProvider(input: {
  rpcUrl: string;
  chainId?: number;
  privateKey?: Hex;
}): FoundryProvider {
  const chainId = input.chainId ?? foundry.id;
  const account = privateKeyToAccount(input.privateKey ?? ANVIL_ACCOUNT0.privateKey);
  const chain = chainFor(chainId, input.rpcUrl);
  const transport = http(input.rpcUrl, { retryCount: 0 });
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return {
    isFoundry: true,
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "wallet_addEthereumChain":
        case "wallet_switchEthereumChain":
          return null;
        case "eth_signTransaction": {
          const tx = asTx(params?.[0]);
          return walletClient.signTransaction({
            account,
            chain,
            to: tx.to,
            data: tx.data,
            value: tx.value,
            gas: tx.gas,
            ...(tx.maxFeePerGas !== undefined && tx.maxPriorityFeePerGas !== undefined
              ? { maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas }
              : { gasPrice: tx.gasPrice }),
            nonce: tx.nonce,
          });
        }
        case "eth_sendTransaction": {
          const tx = asTx(params?.[0]);
          return walletClient.sendTransaction({
            account,
            chain,
            to: tx.to,
            data: tx.data,
            value: tx.value,
            gas: tx.gas,
            ...(tx.maxFeePerGas !== undefined && tx.maxPriorityFeePerGas !== undefined
              ? { maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas }
              : { gasPrice: tx.gasPrice }),
            nonce: tx.nonce,
          });
        }
        default: {
          const result = await publicClient.request({
            method: method as never,
            params: (params ?? []) as never,
          });
          return result;
        }
      }
    },
  };
}

function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === sepolia.id) return { ...sepolia, rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } } };
  if (chainId === foundry.id) return { ...foundry, rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } } };
  return {
    id: chainId,
    name: `foundry-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  };
}

function asTx(raw: unknown): {
  to?: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
} {
  const tx = (raw ?? {}) as Record<string, string | undefined>;
  return {
    ...(tx.to ? { to: tx.to as Address } : {}),
    ...(tx.data ? { data: tx.data as Hex } : {}),
    ...(tx.value !== undefined && tx.value !== "" ? { value: BigInt(tx.value) } : {}),
    ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
    ...(tx.gasPrice ? { gasPrice: BigInt(tx.gasPrice) } : {}),
    ...(tx.maxFeePerGas ? { maxFeePerGas: BigInt(tx.maxFeePerGas) } : {}),
    ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas) } : {}),
    ...(tx.nonce ? { nonce: Number(BigInt(tx.nonce)) } : {}),
  };
}

export function installFoundryProvider(provider: FoundryProvider): void {
  const target = globalThis as typeof globalThis & { window?: { ethereum?: FoundryProvider } };
  if (!target.window) {
    (target as { window: { ethereum: FoundryProvider } }).window = { ethereum: provider };
    return;
  }
  target.window.ethereum = provider;
}
