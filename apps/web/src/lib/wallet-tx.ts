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
  to: Address;
  data: Hex;
}): Promise<Hex> {
  const provider = injected();
  if (!provider) throw new Error("No injected browser wallet. Connect one to publish or grant.");
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: input.from, to: input.to, data: input.data }],
  });
  return hash as Hex;
}

export async function signTypedData(input: { address: Address; payload: string }): Promise<string> {
  const provider = injected();
  if (!provider) throw new Error("No injected browser wallet to sign the attestation.");
  return (await provider.request({
    method: "eth_signTypedData_v4",
    params: [input.address, input.payload],
  })) as string;
}
