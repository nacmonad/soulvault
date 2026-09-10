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

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { useDocumentRegistryAddress } from "@/hooks/useDocumentRegistryAddress";
import { asDocHash, requestRehydration } from "@/lib/document-registry";
import {
  assertBundleAnchoredOnChain,
  evaluateSelfieProof,
  getBrowserWorldRehydrateGate,
  parsePastedSelfieProof,
  publicHydrationError,
  RehydrateGateError,
} from "@/lib/document-rehydrate";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";

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

function nullifierStoreKey(appId: string, action: string) {
  return `soulvault.world.nullifiers.${appId}.${action}`;
}

function loadConsumedNullifiers(appId: string, action: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(nullifierStoreKey(appId, action));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function saveConsumedNullifier(appId: string, action: string, nullifier: string) {
  const next = loadConsumedNullifiers(appId, action);
  next.add(nullifier);
  sessionStorage.setItem(nullifierStoreKey(appId, action), JSON.stringify([...next]));
}

export default function DocumentsRehydratePage() {
  const { address, connector, sendTransaction, signTypedData } = useSoulVaultWallet();
  const { documents, activeGrants, status } = useDocumentEvents({
    recipient: address,
    live: true,
  });
  const [bundle, setBundle] = useState<PublicDocumentBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<SignedRehydrationKeyAttestation | null>(null);
  const [key, setKey] = useState<RehydrationKey | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [selfieOk, setSelfieOk] = useState(false);
  const [proofText, setProofText] = useState("");
  const [requestTx, setRequestTx] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const config = getBrowserSoulVaultClientConfig();
  const { address: registry } = useDocumentRegistryAddress(bundle);
  const world = getBrowserWorldRehydrateGate();
  const worldBlocking = world.mode === "error" || (world.mode === "required" && !selfieOk);

  const onChain = bundle ? documents.documents.get(asDocHash(bundle.artifact.documentId)) : undefined;
  const grants = useMemo(() => {
    if (!bundle || !address) return [];
    const hash = asDocHash(bundle.artifact.documentId);
    return activeGrants.filter((grant) => grant.docHash === hash);
  }, [activeGrants, bundle, address]);

  if (!address) {
    return (
      <div>
        <p className="eyebrow text-primary">Documents</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Rehydrate</h1>
        <p className="mt-2 text-sm text-muted-foreground">Connect a wallet to rehydrate a bundle.</p>
      </div>
    );
  }

  async function onUpload(file: File) {
    setError(null);
    setRevealed(new Set());
    setBundle(null);
    try {
      const parsed = parsePublicDocumentBundle(await file.text());
      const published = documents.documents.get(asDocHash(parsed.artifact.documentId));
      assertBundleAnchoredOnChain({ bundle: parsed, published });
      setBundle(parsed);
    } catch (cause) {
      setError(publicHydrationError(cause));
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
      setError(publicHydrationError(cause));
    }
  }

  /**
   * Onchain request path: the requestRehydration tx binds msg.sender to the
   * rehydration public key, so no out-of-band attestation exchange is needed —
   * the author grants straight from the RehydrationRequested event.
   */
  async function requestOnchain() {
    if (!address || !config || !registry || !bundle) return;
    setError(null);
    setRequestBusy(true);
    try {
      const next = await loadOrCreateRehydrationKey({ store: new LocalRehydrationStore(address) });
      setKey(next);
      const hash = await requestRehydration({
        from: address,
        documentId: bundle.artifact.documentId,
        rehydrationPublicKey: next.publicKey,
        send: sendTransaction,
      });
      setRequestTx(hash);
    } catch (cause) {
      setError(publicHydrationError(cause));
    } finally {
      setRequestBusy(false);
    }
  }

  function presentSelfie() {
    if (world.mode !== "required" || !address) return;
    setError(null);
    try {
      const result = evaluateSelfieProof({
        proof: parsePastedSelfieProof(proofText),
        expectedSignal: address,
        consumedNullifiers: loadConsumedNullifiers(world.appId, world.action),
      });
      if (!result.ok) {
        throw new RehydrateGateError("SELFIE_REJECTED", `Selfie Check failed (${result.reason}).`);
      }
      saveConsumedNullifier(world.appId, world.action, result.nullifier);
      setSelfieOk(true);
    } catch (cause) {
      setSelfieOk(false);
      setError(publicHydrationError(cause));
    }
  }

  function viewFor(revealedIds: Set<string>) {
    if (!bundle || !address || !key) return bundle?.artifact.content ?? "";
    if (worldBlocking) return bundle.artifact.content;
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
    if (worldBlocking) {
      setError(
        world.mode === "error"
          ? world.message
          : "World Selfie Check is required before the first unwrap.",
      );
      return;
    }
    setError(null);
    const next = new Set(revealed);
    if (next.has(slotId)) next.delete(slotId);
    else next.add(slotId);
    try {
      viewFor(next);
      setRevealed(next);
    } catch (cause) {
      setError(publicHydrationError(cause));
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
        Upload the public bundle, then request rehydration — the request tx
        binds your wallet to your rehydration key on-chain. The author grants
        from their Grants tab; delivered grants arrive as events. Ciphertexts
        never come from events. A delivered READ grant is a permanent
        capability — there is no revoke.
      </p>
      {connector === "ledger" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Ledger session active — the rehydration-key attestation is clear-signed on
          the device.
        </p>
      ) : null}
      <WorldGateBanner world={world} selfieOk={selfieOk} />
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
        <Button onClick={() => void requestOnchain()} disabled={!address || !bundle || requestBusy}>
          {requestBusy
            ? connector === "ledger"
              ? "Confirm on Ledger…"
              : "Requesting…"
            : connector === "ledger"
              ? "Request rehydration on Ledger"
              : "Request rehydration"}
        </Button>
        {requestTx ? (
          <p className="mt-2 w-full font-mono text-xs break-all">
            Request posted — tx {requestTx}. The author grants from their Grants
            tab; grants appear here as they land.
          </p>
        ) : null}
        <details className="mt-2 w-full border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Manual attestation (for authors who grant by pasted JSON)
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Only needed when the author is not watching on-chain requests. Sign
            the rehydration-key attestation and copy the JSON to them directly.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void attest()} disabled={!address}>
              {connector === "ledger" ? "Attest rehydration key on Ledger" : "Attest rehydration key"}
            </Button>
            {attestation ? (
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(attestation, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
                  )
                }
              >
                Copy attestation JSON
              </Button>
            ) : null}
          </div>
        </details>
      </div>

      {world.mode === "required" ? (
        <div className="mt-4 border border-border bg-card p-4">
          <p className="text-sm font-medium">World Selfie Check</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Present a credential 11 proof bound to this wallet before the first unwrap.
            Scope: {world.appId} / {world.action}.
          </p>
          <textarea
            value={proofText}
            onChange={(event) => setProofText(event.target.value)}
            placeholder='{"nullifier":"…","credentialId":11,"signal":"0x…"}'
            className="mt-3 min-h-24 w-full border border-border bg-background p-3 font-mono text-xs outline-none focus:border-ring"
            aria-label="Selfie Check proof JSON"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={presentSelfie} disabled={selfieOk}>
              {selfieOk ? "Selfie Check presented" : "Present Selfie Check"}
            </Button>
          </div>
        </div>
      ) : null}

      {bundle ? (
        <>
          <p className="mt-4 font-mono text-xs break-all">{bundle.artifact.documentId}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {onChain ? "docHash matches registry. Slot list covers the artifact." : "Waiting for DocumentPublished in the cache."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {bundle.artifact.slots.map((slot) => {
              const granted = grants.some((grant) => grant.slotId === slot.slotId);
              return (
                <Button
                  key={slot.slotId}
                  size="xs"
                  variant={revealed.has(slot.slotId) ? "default" : "outline"}
                  disabled={!granted || !key || worldBlocking}
                  onClick={() => toggle(slot.slotId)}
                >
                  {slot.slotId} {granted ? "" : "(no grant)"}
                </Button>
              );
            })}
          </div>
          <pre key={[...revealed].sort().join("|")} className="mt-4 whitespace-pre-wrap border border-border bg-card p-4 font-mono text-sm">
            {body}
          </pre>
        </>
      ) : null}
    </div>
  );
}

function WorldGateBanner({
  world,
  selfieOk,
}: {
  world: ReturnType<typeof getBrowserWorldRehydrateGate>;
  selfieOk: boolean;
}) {
  if (world.mode === "error") {
    return <p className="mt-3 text-sm text-destructive">{world.message}</p>;
  }
  if (world.mode === "required") {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        World Selfie Check: <span className="chip">{selfieOk ? "presented" : "required"}</span>
      </p>
    );
  }
  if (world.unconfigured) {
    return (
      <p className="mt-3 text-sm text-destructive">
        World Selfie Check app id / verifier is unset. Gate is off — set{" "}
        <span className="font-mono">NEXT_PUBLIC_WORLD_APP_ID</span> to require it.
      </p>
    );
  }
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      World Selfie Check: <span className="chip">off</span>
    </p>
  );
}
