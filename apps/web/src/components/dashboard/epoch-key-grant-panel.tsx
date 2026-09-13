"use client";

/**
 * Epoch key grant panel — the owner's response to `EpochKeyRequested`.
 *
 * Flow (docs/epoch-key-grant-protocol.md, `sv:epoch-grant:v1`):
 *  1. The successor posts `swarm.requestEpochKey(keyName)` on-chain.
 *  2. This panel surfaces the request (from the swarm event feed) with a
 *     copyable owner CLI command — the Ledger Key Ring decrypt happens in the
 *     wallet-cli (key material never leaves the device).
 *  3. The owner pastes the recovered key material into the input box.
 *  4. "Send grant" seals it ECDH to the requester's published pubkey
 *     (secp256k1-ecdh-aes-256-gcm, same wire format as DM messages), uploads
 *     the envelope through the storage API route, and posts
 *     `AgentMessagePosted(to=requester, topic="epoch-key-grant")` — signed via
 *     the connected wallet (Ledger channel when connected as owner).
 *
 * Storage-agnostic by design: payloadRef is an opaque locator resolved by the
 * API route (0G today; IPFS later without touching this component).
 */
import { useCallback, useMemo, useState } from "react";
import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import { gcm } from "@noble/ciphers/aes";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { bytesToBase64, bytesToHex, hexToBytesFlexible } from "@soulvault/protocol";

import { Button } from "@/components/ui/button";
import { CopyableAddress } from "@/components/dashboard/copyable-address";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { errorMessage } from "@/lib/error-message";
import { shortTx, explorerTxUrl } from "@/lib/format";
import { createSepoliaEnsClient, getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import type { EpochKeyRequest } from "@/lib/onchain/reducers";
import { SEPOLIA_CHAIN_ID } from "@/lib/chains";
import { sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";

const SWARM_POST_MESSAGE_ABI = [
  {
    type: "function",
    name: "postMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "topic", type: "string" },
      { name: "seq", type: "uint64" },
      { name: "epoch", type: "uint64" },
      { name: "payloadRef", type: "string" },
      { name: "payloadHash", type: "bytes32" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getLastSenderSeq",
    stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/**
 * ECDH-wrap plaintext to the requester's uncompressed secp256k1 pubkey —
 * wire-compatible with the CLI's `secp256k1-ecdh-aes-256-gcm` DM envelope
 * (shared secret = x-coordinate, AES key = sha256(x), tag appended to ct).
 */
function ecdhSealToPubkey(plaintext: Uint8Array, recipientPubkeyHex: string) {
  const recipientPubkey = hexToBytesFlexible(recipientPubkeyHex);
  const ephemeralPrivateKey = secp256k1.utils.randomPrivateKey();
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralPrivateKey, false);
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivateKey, recipientPubkey);
  const sharedX = sharedPoint.subarray(1, 33); // x-coordinate, per wire contract
  const aesKey = sha256(sharedX);
  const nonce = randomBytes(12);
  const sealed = gcm(aesKey, nonce).encrypt(plaintext);
  return {
    ciphertext: bytesToBase64(sealed),
    ephemeralPublicKey: bytesToHex(ephemeralPublicKey),
    nonce: bytesToHex(nonce),
    algorithm: "secp256k1-ecdh-aes-256-gcm" as const,
  };
}

export function EpochKeyGrantPanel({
  requests,
  swarmAddress,
  ownerAddress,
}: {
  requests: EpochKeyRequest[];
  swarmAddress: Address | null;
  ownerAddress: Address | null;
}) {
  const { address } = useSoulVaultWallet();
  const [busy, setBusy] = useState(false);
  const [keyInput, setKeyInput] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentTx, setSentTx] = useState<{ hash: Hex; explorer?: string } | null>(null);

  const isOwner = useMemo(
    () => Boolean(address && ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase()),
    [address, ownerAddress],
  );

  const grant = useCallback(
    async (request: EpochKeyRequest) => {
      if (!address || !swarmAddress) return;
      const secretHex = (keyInput[request.keyName] ?? "").trim();
      if (!secretHex) {
        setError("Paste the key material recovered from the Ledger Key Ring first.");
        return;
      }
      if (!request.requesterPubkey || request.requesterPubkey === "0x") {
        setError("Requester has no published pubkey on the swarm — cannot wrap.");
        return;
      }
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const plaintext = new TextEncoder().encode(secretHex);
        const wrapped = ecdhSealToPubkey(plaintext, request.requesterPubkey);
        const envelope = {
          version: 1,
          type: "sv:epoch-grant",
          keyName: request.keyName,
          epoch: Number(request.epoch),
          grantedBy: address,
          requestedBy: request.requester,
          recipientPubkey: request.requesterPubkey,
          payload: wrapped,
          createdAt: new Date().toISOString(),
        };

        // Storage behind the API seam (0G today, swappable later).
        const uploadRes = await fetch("/api/storage/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ envelope }),
        });
        if (!uploadRes.ok) throw new Error(`storage upload failed (${uploadRes.status})`);
        const upload = (await uploadRes.json()) as { payloadRef: string };
        const payloadHash = keccak256(toHex(new TextEncoder().encode(JSON.stringify(envelope, null, 2))));

        const config = getBrowserSoulVaultClientConfig();
        if (!config) throw new Error("SoulVault client not configured — set the RPC URL in dashboard settings.");
        const publicClient = createSepoliaEnsClient(config);
        const [lastSeq, currentEpoch] = await Promise.all([
          publicClient.readContract({
            address: swarmAddress,
            abi: SWARM_POST_MESSAGE_ABI,
            functionName: "getLastSenderSeq",
            args: [address],
          }),
          publicClient.readContract({
            address: swarmAddress,
            abi: SWARM_POST_MESSAGE_ABI,
            functionName: "currentEpoch",
          }),
        ]);

        const txHash = await sendWalletTransaction({
          from: address,
          to: swarmAddress,
          data: encodeFunctionData({
            abi: SWARM_POST_MESSAGE_ABI,
            functionName: "postMessage",
            args: [
              request.requester,
              "epoch-key-grant",
              lastSeq + 1n,
              currentEpoch,
              upload.payloadRef,
              payloadHash,
              3600n,
            ],
          }),
          chainId: SEPOLIA_CHAIN_ID,
        });
        const receipt = await waitForWalletReceipt(txHash);
        if (receipt.status !== "success") throw new Error(`grant DM reverted (tx ${txHash}).`);

        setSentTx({ hash: txHash, explorer: explorerTxUrl(txHash, SEPOLIA_CHAIN_ID) ?? undefined });
        setNotice(`Grant DM sent to ${request.requester} for ${request.keyName}.`);
        setKeyInput((prev) => ({ ...prev, [request.keyName]: "" }));
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [address, swarmAddress, keyInput],
  );

  if (requests.length === 0) return null;

  return (
    <div className="mt-8 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Epoch key ring requests</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Successors requesting recovery material. Respond by decrypting the escrow on
        your Ledger Key Ring (<code>wallet-cli ring decrypt</code>), pasting the key
        here — it is sealed ECDH to the requester&apos;s published pubkey and delivered
        as a swarm DM (<code>topic=epoch-key-grant</code>). Key material never touches
        the chain or the storage layer in plaintext.
      </p>
      {requests.map((request) => (
        <div key={`${request.requester}-${request.keyName}`} className="mt-4 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-mono font-semibold">{request.keyName}</span>
            <CopyableAddress address={request.requester} />
            <span className="text-muted-foreground">epoch {Number(request.epoch)}</span>
            <span className="text-muted-foreground">{shortTx(request.requestedAt.txHash)}</span>
          </div>
          {request.reason ? (
            <p className="mt-1 text-xs text-muted-foreground">Reason: {request.reason}</p>
          ) : null}
          {!isOwner ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Connect the owner wallet ({ownerAddress ? <CopyableAddress address={ownerAddress} /> : "org owner"}) to respond.
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs"
                placeholder="Paste key material from wallet-cli ring decrypt"
                value={keyInput[request.keyName] ?? ""}
                onChange={(e) => setKeyInput((prev) => ({ ...prev, [request.keyName]: e.target.value }))}
              />
              <Button size="sm" disabled={busy} onClick={() => grant(request)}>
                {busy ? "Sending…" : "Send grant (sign with Ledger)"}
              </Button>
            </div>
          )}
        </div>
      ))}
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
      {notice ? <p className="mt-2 text-xs text-green-600">{notice}</p> : null}
      {sentTx ? (
        <p className="mt-2 text-xs">
          Grant tx:{" "}
          {sentTx.explorer ? (
            <a className="underline" href={sentTx.explorer} target="_blank" rel="noreferrer">
              {shortTx(sentTx.hash)}
            </a>
          ) : (
            shortTx(sentTx.hash)
          )}
        </p>
      ) : null}
    </div>
  );
}
