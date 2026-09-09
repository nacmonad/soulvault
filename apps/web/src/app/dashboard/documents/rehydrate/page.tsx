"use client";

import { useMemo, useState } from "react";
import {
  buildRehydrationKeyTypedData,
  loadOrCreateRehydrationKey,
  parsePublicDocumentBundle,
  rehydrateGrantedDocument,
  type PublicDocumentBundle,
  type RehydrationKey,
  type RehydrationKeyStore,
  type SignedRehydrationKeyAttestation,
} from "@soulvault/protocol";
import type { Address } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { asDocHash, documentRegistryAddress } from "@/lib/document-registry";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { signTypedData } from "@/lib/wallet-tx";

class LocalRehydrationStore implements RehydrationKeyStore {
  constructor(private readonly wallet: string) {}
  private id(keyId: string) {
    return `soulvault.rehydration.${this.wallet.toLowerCase()}.${keyId}`;
  }
  async get(keyId: string) {
    return localStorage.getItem(this.id(keyId));
  }
  async set(keyId: string, privateKeyHex: string) {
    localStorage.setItem(this.id(keyId), privateKeyHex);
  }
  async remove(keyId: string) {
    localStorage.removeItem(this.id(keyId));
  }
}

export default function DocumentsRehydratePage() {
  const { address } = useSoulVaultWallet();
  const { documents, activeGrants, status } = useDocumentEvents({
    recipient: address,
  });
  const [bundle, setBundle] = useState<PublicDocumentBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<SignedRehydrationKeyAttestation | null>(null);
  const [key, setKey] = useState<RehydrationKey | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const config = getBrowserSoulVaultClientConfig();
  const registry = documentRegistryAddress();

  const onChain = bundle ? documents.documents.get(asDocHash(bundle.artifact.documentId)) : undefined;
  const grants = useMemo(() => {
    if (!bundle || !address) return [];
    const hash = asDocHash(bundle.artifact.documentId);
    return activeGrants.filter((grant) => grant.docHash === hash);
  }, [activeGrants, bundle, address]);

  if (!address) return null;

  async function onUpload(file: File) {
    setError(null);
    setRevealed(new Set());
    try {
      const parsed = parsePublicDocumentBundle(await file.text());
      const hash = asDocHash(parsed.artifact.documentId);
      const published = documents.documents.get(hash);
      if (!published) {
        setError("docHash is not in the registry event cache. Scan events, then retry.");
        setBundle(parsed);
        return;
      }
      if (published.docHash !== hash) {
        setError("Bundle documentId does not match the on-chain docHash.");
        return;
      }
      setBundle(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bundle parse failed");
    }
  }

  async function attest() {
    if (!address || !config || !registry) return;
    setError(null);
    try {
      const next = await loadOrCreateRehydrationKey({ store: new LocalRehydrationStore(address) });
      const typed = buildRehydrationKeyTypedData({
        wallet: address,
        publicKey: next.publicKey,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24),
        chainId: config.chainId,
        verifyingContract: registry,
      });
      const payload = JSON.stringify({
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          RehydrationKey: typed.types.RehydrationKey,
        },
        domain: typed.domain,
        primaryType: typed.primaryType,
        message: {
          wallet: typed.message.wallet,
          rehydrationPublicKey: typed.message.rehydrationPublicKey,
          expiry: typed.message.expiry.toString(),
        },
      });
      const signature = await signTypedData({ address, payload });
      const signed = { ...typed, signature };
      setKey(next);
      setAttestation(signed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Attestation failed");
    }
  }

  function viewFor(revealedIds: Set<string>) {
    if (!bundle || !address || !key) return bundle?.artifact.content ?? "";
    const subset = grants.filter((grant) => revealedIds.has(grant.slotId));
    if (subset.length === 0) return bundle.artifact.content;
    return rehydrateGrantedDocument({
      artifact: bundle.artifact,
      encryptedSlots: bundle.encryptedSlots,
      recipientWallet: address,
      rehydrationKey: key,
      grants: subset.map((grant) => ({
        slotId: grant.slotId,
        recipient: grant.recipient,
        recipientKeyFingerprint: key.fingerprint,
        wrap: grant.wrap,
      })),
    });
  }

  function toggle(slotId: string) {
    if (!grants.some((grant) => grant.slotId === slotId)) return;
    setError(null);
    const next = new Set(revealed);
    if (next.has(slotId)) next.delete(slotId);
    else next.add(slotId);
    try {
      viewFor(next);
      setRevealed(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rehydrate failed");
    }
  }

  let body = bundle?.artifact.content ?? "";
  try {
    body = viewFor(revealed);
  } catch {
    body = bundle?.artifact.content ?? "";
  }

  return (
    <div>
      <p className="eyebrow text-primary">Documents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Rehydrate</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Upload the public bundle. Ciphertexts never come from events. World Selfie
        Check is off until that branch lands. A delivered READ grant is permanent.
      </p>
      {status === "error" ? <p className="mt-3 text-sm text-destructive">Event config missing or scan failed.</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center border border-border px-2.5 text-sm">
          Upload bundle
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUpload(file);
            }}
          />
        </label>
        <Button onClick={() => void attest()} disabled={!address}>
          Attest rehydration key
        </Button>
        {attestation ? (
          <Button
            variant="outline"
            onClick={() => navigator.clipboard.writeText(JSON.stringify(attestation, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2))}
          >
            Copy attestation JSON
          </Button>
        ) : null}
      </div>

      {bundle ? (
        <>
          <p className="mt-4 font-mono text-xs break-all">{bundle.artifact.documentId}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {onChain ? "docHash matches registry." : "Waiting for DocumentPublished in the cache."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {bundle.artifact.slots.map((slot) => {
              const granted = grants.some((grant) => grant.slotId === slot.slotId);
              return (
                <Button
                  key={slot.slotId}
                  size="xs"
                  variant={revealed.has(slot.slotId) ? "default" : "outline"}
                  disabled={!granted || !key}
                  onClick={() => toggle(slot.slotId)}
                >
                  {slot.slotId} {granted ? "" : "(no grant)"}
                </Button>
              );
            })}
          </div>
          <pre className="mt-4 whitespace-pre-wrap border border-border bg-card p-4 font-mono text-sm">{body}</pre>
        </>
      ) : null}
    </div>
  );
}
