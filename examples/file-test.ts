import { ZgFile, Indexer } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import dotenv from "dotenv"

dotenv.config()

const provider = new ethers.JsonRpcProvider("https://evmrpc-testnet.0g.ai");
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const indexer = new Indexer("https://indexer-storage-testnet-turbo.0g.ai");

// Upload — flow contract is resolved internally by the Indexer
const file = await ZgFile.fromFilePath("test.txt");
const [tree, treeErr] = await file.merkleTree();
console.log("Root Hash:", tree?.rootHash());

const [tx, uploadErr] = await indexer.upload(file, "https://evmrpc-testnet.0g.ai", signer);
await file.close();
