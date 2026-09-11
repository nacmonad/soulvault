import http from "node:http";

import {
  createWalletClient,
  http as viemHttp,
  type Address,
  type Chain,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Sidecar signer for the injected-wallet mock (Alice / Mallory).
 *
 * The in-page `window.ethereum` mock cannot hold private keys or sign, so it
 * relays signing/broadcast requests to this worker-scoped HTTP server, which
 * signs with the mapped Anvil test key (viem) and broadcasts to the local
 * node. Deterministic, no browser cryptography needed.
 *
 * Routes:
 *   POST /sendTransaction  { from, to?, data, value?, gas? }         → { hash }
 *   POST /signTypedData    { address, payload } (eth_signTypedData_v4 body) → { signature }
 */
export type SidecarSigner = {
  url: string;
  stop(): Promise<void>;
};

export async function startSidecarSigner(input: {
  port?: number;
  rpcUrl: string;
  chainId: number;
  keys: Record<string, string>;
}): Promise<SidecarSigner> {
  const chain: Chain = {
    id: input.chainId,
    name: "soulvault-e2e-local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [input.rpcUrl] } },
  };
  const wallets = new Map<Address, { account: PrivateKeyAccount; wallet: ReturnType<typeof createWalletClient> }>();
  for (const key of Object.values(input.keys)) {
    const account = privateKeyToAccount(key as `0x${string}`);
    wallets.set(account.address.toLowerCase() as Address, {
      account,
      wallet: createWalletClient({ account, chain, transport: viemHttp(input.rpcUrl) }),
    });
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.method !== "POST") { response.writeHead(405).end(); return; }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (request.url === "/sendTransaction") {
        const hash = await handleSendTransaction(body);
        respond(response, 200, { hash });
      } else if (request.url === "/signTypedData") {
        const signature = await handleSignTypedData(body);
        respond(response, 200, { signature });
      } else {
        respond(response, 404, { message: `unknown route ${request.url}` });
      }
    } catch (cause) {
      respond(response, 500, { message: cause instanceof Error ? cause.message : String(cause) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 0, "127.0.0.1", () => resolve());
  });
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("sidecar signer did not bind a TCP port");

  return {
    url: `http://127.0.0.1:${bound.port}`,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  function requireWallet(from: unknown) {
    const address = typeof from === "string" ? from.toLowerCase() as Address : undefined;
    const entry = address ? wallets.get(address) : undefined;
    if (!entry) throw new Error(`sidecar signer has no key for ${String(from)}`);
    return entry;
  }

  async function handleSendTransaction(body: Record<string, unknown>): Promise<Hex> {
    const { wallet } = requireWallet(body.from);
    return wallet.sendTransaction({
      to: (body.to as Address | undefined) ?? undefined,
      data: (body.data as Hex | undefined) ?? "0x",
      value: typeof body.value === "string" ? BigInt(body.value) : undefined,
      gas: typeof body.gas === "string" ? BigInt(body.gas) : undefined,
      nonce: typeof body.nonce === "string" ? BigInt(body.nonce) : undefined,
    } as never);
  }

  async function handleSignTypedData(body: { address?: string; payload?: string }): Promise<Hex> {
    const { account } = requireWallet(body.address);
    const typed = JSON.parse(body.payload ?? "{}") as {
      domain?: Record<string, unknown>;
      types?: Record<string, Array<{ name: string; type: string }>>;
      primaryType?: string;
      message?: Record<string, unknown>;
    };
    // viem builds the EIP712Domain entry from `domain`; the payload may or may
    // not carry it explicitly. Coerce decimal-string integers (uint64 expiry is
    // stringified for cross-wallet round-tripping) back to BigInt.
    const types = { ...(typed.types ?? {}) } as Record<string, Array<{ name: string; type: string }>>;
    delete types.EIP712Domain;
    const message: Record<string, unknown> = { ...(typed.message ?? {}) };
    for (const fields of Object.values(types)) {
      for (const field of fields) {
        if (/^u?int/.test(field.type)) {
          const value = message[field.name];
          if (typeof value === "string" && /^-?\d+$/.test(value)) message[field.name] = BigInt(value);
        }
      }
    }
    // One whole-object cast: viem's typed-data generics are const-inferred and
    // fight per-field casts (`as never` poisons the parameter to never).
    const typedData = {
      domain: typed.domain ?? {},
      types,
      primaryType: typed.primaryType ?? "RehydrationKey",
      message,
    } as unknown as Parameters<PrivateKeyAccount["signTypedData"]>[0];
    return account.signTypedData(typedData);
  }

  function respond(response: http.ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  }
}
