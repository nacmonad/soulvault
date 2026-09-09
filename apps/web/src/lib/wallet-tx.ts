import type { Address, Hex } from "viem";

type Injected = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

function injected(): Injected | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { ethereum?: Injected }).ethereum;
}

export async function sendWalletTransaction(input: {
  from: Address;
  /** `null` = contract creation (eth_sendTransaction with no `to`). */
  to: Address | null;
  data: Hex;
  value?: bigint;
}): Promise<Hex> {
  const provider = injected();
  if (!provider) throw new Error("No injected browser wallet. Connect one to publish or grant.");
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.from,
        ...(input.to !== null ? { to: input.to } : {}),
        data: input.data,
        ...(input.value !== undefined ? { value: `0x${input.value.toString(16)}` } : {}),
      },
    ],
  });
  return hash as Hex;
}

/**
 * Send a contract-creation transaction and wait for the receipt.
 * Returns the deployed address from the receipt's `contractAddress` field.
 */
export async function deployWalletContract(input: {
  from: Address;
  bytecode: Hex;
}): Promise<{ txHash: Hex; contractAddress: Address }> {
  const hash = await sendWalletTransaction({ from: input.from, to: null, data: input.bytecode });
  const receipt = await waitForWalletReceipt(hash);
  if (receipt.status !== "success") {
    throw new Error(`Deploy transaction reverted (tx ${hash}).`);
  }
  if (!receipt.contractAddress || receipt.contractAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Deploy receipt has no contractAddress (tx ${hash}).`);
  }
  return { txHash: hash, contractAddress: receipt.contractAddress };
}

export async function waitForWalletReceipt(hash: Hex): Promise<{
  status: "success" | "reverted";
  contractAddress?: Address;
  blockNumber: bigint;
}> {
  const provider = injected();
  if (!provider) throw new Error("No injected browser wallet.");
  // Poll eth_getTransactionReceipt — static export has no viem public client wired
  // into this module, and every browser wallet exposes the standard JSON-RPC methods.
  for (let attempt = 0; attempt < 120; attempt++) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as {
      status?: Hex;
      contractAddress?: Address;
      blockNumber?: Hex;
    } | null;
    if (receipt) {
      return {
        status: receipt.status === "0x1" ? "success" : "reverted",
        contractAddress: receipt.contractAddress,
        blockNumber: BigInt(receipt.blockNumber ?? "0x0"),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for transaction receipt (tx ${hash}).`);
}

export async function signTypedData(input: { address: Address; payload: string }): Promise<string> {
  const provider = injected();
  if (!provider) throw new Error("No injected browser wallet to sign the attestation.");
  return (await provider.request({
    method: "eth_signTypedData_v4",
    params: [input.address, input.payload],
  })) as string;
}
