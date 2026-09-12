import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export function anvilBin(): string {
  return process.env.ANVIL_BIN ?? join(homedir(), ".foundry/bin/anvil");
}

export async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("could not bind an ephemeral port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForRpc(rpcUrl: string, attempts = 80): Promise<void> {
  let last = "not started";
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const body = (await response.json()) as { result?: string };
      if (body.result) return;
      last = JSON.stringify(body);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`anvil RPC did not come up at ${rpcUrl}: ${last}`);
}

export type AnvilHandle = {
  rpcUrl: string;
  port: number;
  chainId: number;
  stop(): void;
};

export async function startAnvil(opts?: { forkUrl?: string; chainId?: number }): Promise<AnvilHandle> {
  const port = await pickFreePort();
  const chainId = opts?.chainId ?? 31337;
  const args = ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent"];
  if (opts?.forkUrl) args.push("--fork-url", opts.forkUrl);
  const child: ChildProcess = spawn(anvilBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code) => {
    if (code && code !== 0 && stderr) {
      console.warn(`[anvil] exited ${code}: ${stderr.slice(0, 400)}`);
    }
  });
  const rpcUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForRpc(rpcUrl, opts?.forkUrl ? 120 : 80);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return {
    rpcUrl,
    port,
    chainId,
    stop() {
      child.kill("SIGTERM");
    },
  };
}
