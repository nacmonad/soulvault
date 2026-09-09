import { serializeSignature, type Address, type Hex } from "viem";

export type ChainSender = (input: { from: Address; to: Address; data: Hex }) => Promise<Hex>;

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
  value?: bigint;
}): Promise<Hex> {
  const provider = injected();
  if (!provider) throw new Error("No injected browser wallet. Connect one to publish or grant.");
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.from,
        to: input.to,
        data: input.data,
        ...(input.value !== undefined ? { value: `0x${input.value.toString(16)}` } : {}),
      },
    ],
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

/** Ledger Ethereum app returns v as 0/1, 27/28, or EIP-155. */
export function yParityFromV(v: number): 0 | 1 {
  if (v === 0 || v === 27) return 0;
  if (v === 1 || v === 28) return 1;
  return (v % 2 === 0 ? 1 : 0) as 0 | 1;
}

export function asHex(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

export function ledgerSignature(sig: { r: string; s: string; v: number }): {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
} {
  return { r: asHex(sig.r), s: asHex(sig.s), yParity: yParityFromV(sig.v) };
}

export function serializedLedgerSignature(sig: { r: string; s: string; v: number }): Hex {
  return serializeSignature(ledgerSignature(sig));
}
