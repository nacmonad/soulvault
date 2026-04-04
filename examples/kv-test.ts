import { Batcher, KvClient } from "@0gfoundation/0g-ts-sdk";
import { getBytes }          from "ethers";
import dotenv                from "dotenv";
dotenv.config();

const RPC_URL      = process.env.RPC_URL!;      // e.g. https://evmrpc-testnet.0g.ai
const KV_URL       = process.env.KV_URL!;       // https://kv.scotthorlacher.dev
const PRIVATE_KEY  = process.env.PRIVATE_KEY!;  // your wallet
const FLOW_CONTRACT = "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296";
const STREAM_ID     = "0x000000000000000000000000000000000000000000000000000000000000f2bd";

async function main() {
  // 1) WRITE with Batcher
  const nodes = [RPC_URL];
  const batcher = new Batcher(
    0,               // shard ID (usually 0)
    nodes,           // EVM RPC endpoints
    FLOW_CONTRACT,   // flow contract address
    RPC_URL,         // RPC for signing/submission
    { privateKey: PRIVATE_KEY }
  );

  const key = getBytes("0x1234abcd");
  const val = new TextEncoder().encode("🚀 Hello KV!");

  batcher.streamDataBuilder.set(STREAM_ID, key, val);
  const [txReceipt, txError] = await batcher.exec();
  console.log("Write TX:", txReceipt, txError);

  // 2) READ with KvClient
  const kv = new KvClient(KV_URL, {
    headers: { Authorization: `Bearer ${process.env.ACCESS_JWT}` }
  });
  const raw = await kv.getValue(STREAM_ID, key);
  const bytes = raw instanceof Uint8Array
    ? raw
    : new Uint8Array(raw as ArrayBuffer);
  console.log("Read:", new TextDecoder().decode(bytes));
}

main().catch(console.error);

