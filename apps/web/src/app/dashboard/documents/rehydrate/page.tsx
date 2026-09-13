"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  buildRehydrationKeyTypedData,
  loadOrCreateRehydrationKey,
  parsePublicDocumentBundle,
  rehydrateGrantedDocument,
  rehydrationKeyFingerprint,
  type PublicDocumentBundle,
  type RehydrationKey,
  type RehydrationKeyStore,
  type SignedRehydrationKeyAttestation,
} from "@soulvault/protocol";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { useDocumentRegistryAddress } from "@/hooks/useDocumentRegistryAddress";
import {
  asDocHash,
  documentRegistryScanStartBlock,
  fetchPublishedAnchorFromRegistry,
  requestRehydration,
  resolveRootEnsName,
} from "@/lib/document-registry";
import { parseDocumentEvent } from "@/lib/onchain/watcher";
import {
  assertBundleAnchoredOnChain,
  compareAuthorSessionRun,
  diagnoseSlotGrant,
  evaluateSelfieProof,
  getBrowserWorldRehydrateGate,
  parsePastedSelfieProof,
  publicHydrationError,
  RehydrateGateError,
  type PublishedDocumentAnchor,
} from "@/lib/document-rehydrate";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { explorerTxUrl, shortTx } from "@/lib/format";

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

// One in-flight load per wallet: concurrent loadOrCreateRehydrationKey calls
// (mount effect + request/attest handlers) would each generate a different
// key when the store is empty — last-writer-wins in localStorage while the
// request tx binds the other key, and grants then fail to unwrap.
const rehydrationKeyLoads = new Map<string, Promise<RehydrationKey>>();

function loadRehydrationKeyFor(wallet: string): Promise<RehydrationKey> {
  const id = wallet.toLowerCase();
  const existing = rehydrationKeyLoads.get(id);
  if (existing) return existing;
  const promise = loadOrCreateRehydrationKey({ store: new LocalRehydrationStore(id) });
  rehydrationKeyLoads.set(id, promise);
  promise.catch(() => {
    if (rehydrationKeyLoads.get(id) === promise) rehydrationKeyLoads.delete(id);
  });
  return promise;
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
  const { documents, activeGrants, status, events, addSources } = useDocumentEvents({
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
  const [keyError, setKeyError] = useState<string | null>(null);
  const [sessionRun, setSessionRun] = useState<"match" | "mismatch" | "no-session" | null>(null);
  const config = getBrowserSoulVaultClientConfig();
  const { address: registry } = useDocumentRegistryAddress(bundle);
  const world = getBrowserWorldRehydrateGate();
  const worldBlocking = world.mode === "error" || (world.mode === "required" && !selfieOk);

  const onChain = bundle ? documents.documents.get(asDocHash(bundle.artifact.documentId)) : undefined;

  // Load (or create) the local rehydration key as soon as a wallet connects —
  // no signature needed for the onchain request path, and grants delivered
  // later must be unwrappable without re-requesting.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    loadRehydrationKeyFor(address)
      .then((next) => {
        if (cancelled) return;
        setKey(next);
        setKeyError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setKeyError(publicHydrationError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [address]);
  const grants = useMemo(() => {
    if (!bundle || !address) return [];
    const hash = asDocHash(bundle.artifact.documentId);
    return activeGrants.filter((grant) => grant.docHash === hash);
  }, [activeGrants, bundle, address]);

  // Per-slot verdicts: unwrap the wrap with THIS browser's key and try to open
  // the bundle ciphertext with the result. Fails a grant at "unwrap" (key
  // binding mismatch) or "slot-open" (keys from a different redact run) —
  // surfaced instead of the opaque aggregate AUTHENTICATION_FAILED.
  const slotDiagnostics = useMemo(() => {
    if (!bundle || !address || !key || grants.length === 0) return null;
    const map = new Map<string, { ok: true } | { ok: false; stage: "unwrap" | "slot-open" }>();
    for (const grant of grants) {
      map.set(grant.slotId, diagnoseSlotGrant({
        artifact: bundle.artifact,
        encryptedSlots: bundle.encryptedSlots,
        recipientWallet: address,
        rehydrationKey: key,
        grant: { slotId: grant.slotId, recipient: grant.recipient, wrap: grant.wrap },
      }));
    }
    return map;
  }, [bundle, address, key, grants]);
  const usableGrants = useMemo(
    () => (slotDiagnostics ? grants.filter((grant) => slotDiagnostics.get(grant.slotId)?.ok) : grants),
    [grants, slotDiagnostics],
  );
  const failedGrants = useMemo(
    () => (slotDiagnostics ? grants.filter((grant) => slotDiagnostics.get(grant.slotId) && !slotDiagnostics.get(grant.slotId)!.ok) : []),
    [grants, slotDiagnostics],
  );

  // On-chain key bindings: every RehydrationRequested this wallet posted for
  // this document, oldest → newest. Grants are wrapped to whichever request
  // the author fulfilled; if the local key matches none of them, unwrap
  // fails closed (AUTHENTICATION_FAILED) — this panel makes that visible.
  const requestBindings = useMemo(() => {
    if (!bundle || !address) return [];
    const hash = asDocHash(bundle.artifact.documentId).toLowerCase();
    const wallet = address.toLowerCase();
    const found: { rehydrationPublicKey: string; blockNumber: number }[] = [];
    for (const event of events) {
      const parsed = parseDocumentEvent(event);
      if (!parsed || parsed.eventName !== "RehydrationRequested") continue;
      if (parsed.docHash.toLowerCase() !== hash) continue;
      if (parsed.recipient.toLowerCase() !== wallet) continue;
      found.push({ rehydrationPublicKey: parsed.rehydrationPublicKey, blockNumber: Number(event.blockNumber) });
    }
    return found;
  }, [events, bundle, address]);
  const localKeyMatchesBinding = key
    ? requestBindings.some((binding) => binding.rehydrationPublicKey.toLowerCase() === key.publicKey.toLowerCase())
    : null;

  // Every SlotKeyGranted for (this docHash, this wallet), oldest → newest,
  // with the same newest-per-slot-wins rule resolveActiveGrants applies —
  // superseded rows are shown so stale wraps are debuggable, not invisible.
  const grantEvents = useMemo(() => {
    if (!bundle || !address) return [];
    const hash = asDocHash(bundle.artifact.documentId).toLowerCase();
    const wallet = address.toLowerCase();
    const rows: { slotId: string; blockNumber: number; txHash: string; logIndex: number; active: boolean }[] = [];
    const lastIndexBySlot = new Map<string, number>();
    for (const event of events) {
      const parsed = parseDocumentEvent(event);
      if (!parsed || parsed.eventName !== "SlotKeyGranted") continue;
      if (parsed.docHash.toLowerCase() !== hash) continue;
      if (parsed.recipient.toLowerCase() !== wallet) continue;
      lastIndexBySlot.set(parsed.slotId, rows.length);
      rows.push({
        slotId: parsed.slotId,
        blockNumber: Number(event.blockNumber),
        txHash: event.txHash,
        logIndex: event.logIndex,
        active: false,
      });
    }
    for (const index of lastIndexBySlot.values()) rows[index].active = true;
    return rows;
  }, [events, bundle, address]);

  if (!address) {
    return (
      <div>
        <p className="eyebrow text-primary">Documents</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Rehydrate</h1>
        <p className="mt-2 text-sm text-muted-foreground">Connect a wallet to rehydrate a bundle.</p>
      </div>
    );
  }

  /**
   * The bundle is self-contained: it names the registry that anchors it. A
   * consumer outside any org has no ENS discovery path (the registry was
   * announced on the author's org name), so teach the shared watcher the
   * hinted registry for this session — grants/requests stream from it — and
   * verify the publish anchor straight from the chain rather than waiting
   * for the ENS-discovered scan that will never come.
   */
  function watchBundleRegistryHint(registry: { chainId: number; address: string }) {
    void (async () => {
      try {
        const to = registry.address as Address;
        const fromBlock = await documentRegistryScanStartBlock({
          address: to,
          chainId: registry.chainId,
          rootEnsName: resolveRootEnsName(),
          viewer: address ?? undefined,
        });
        await addSources([
          { address: to, kind: "document", chainId: registry.chainId, fromBlock, label: "bundle-hint" },
        ]);
      } catch {
        // Best-effort; the direct anchor check in onUpload is authoritative.
      }
    })();
  }

  async function onUpload(file: File) {
    setError(null);
    setRevealed(new Set());
    setBundle(null);
    setSessionRun(null);
    try {
      const parsed = parsePublicDocumentBundle(await file.text());
      const hash = asDocHash(parsed.artifact.documentId);
      let published: PublishedDocumentAnchor | undefined = documents.documents.get(hash);
      if (!published && parsed.registry?.address) {
        watchBundleRegistryHint(parsed.registry);
        published =
          (await fetchPublishedAnchorFromRegistry({
            registry: parsed.registry,
            docHash: hash,
          })) ?? undefined;
      }
      assertBundleAnchoredOnChain({ bundle: parsed, published });
      setSessionRun(compareAuthorSessionRun(parsed));
      setBundle(parsed);
    } catch (cause) {
      setError(publicHydrationError(cause));
    }
  }

  async function attest() {
    if (!address || !config || !registry) return;
    setError(null);
    try {
      const next = await loadRehydrationKeyFor(address);
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
      const next = await loadRehydrationKeyFor(address);
      setKey(next);
      const hash = await requestRehydration({
        from: address,
        documentId: bundle.artifact.documentId,
        rehydrationPublicKey: next.publicKey,
        send: sendTransaction,
        registryHint: bundle.registry,
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
    const subset = usableGrants.filter((grant) => revealedIds.has(grant.slotId));
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
    const failing = failedGrants.find((grant) => grant.slotId === slotId);
    if (failing) {
      const stage = slotDiagnostics?.get(slotId);
      setError(
        stage && !stage.ok && stage.stage === "slot-open"
          ? `Grant for ${slotId} unwraps, but its slot key does not open this bundle's ciphertext — the granted keys and this bundle come from different redact runs. Re-export/re-publish the bundle from the author's current session, then grant again.`
          : `Grant for ${slotId} cannot be unwrapped by this browser's rehydration key. Click “Request rehydration” to re-bind, then re-grant (newest grant per slot wins).`,
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

  function revealAll() {
    if (grants.length === 0) return;
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
    for (const grant of usableGrants) next.add(grant.slotId);
    if (failedGrants.length > 0) {
      setError(
        `Revealed ${usableGrants.length} of ${grants.length} granted slots — ${failedGrants.length} grant${failedGrants.length === 1 ? "" : "s"} failed per-slot diagnosis (see the failing slot buttons below).`,
      );
    }
    try {
      viewFor(next);
      setRevealed(new Set(next));
    } catch (cause) {
      setError(publicHydrationError(cause));
    }
  }

  function hideAll() {
    setRevealed(new Set());
  }

  const grantedCount = usableGrants.filter((grant) => revealed.has(grant.slotId)).length;
  let view: { body: string; mode: "empty" | "redacted" | "rehydrated" | "error"; unwrapError: string | null } = {
    body: "",
    mode: "empty",
    unwrapError: null,
  };
  if (bundle) {
    if (grantedCount === 0 || worldBlocking || !key) {
      view = { body: bundle.artifact.content, mode: "redacted", unwrapError: null };
    } else {
      try {
        view = { body: viewFor(revealed), mode: "rehydrated", unwrapError: null };
      } catch (cause) {
        view = { body: bundle.artifact.content, mode: "error", unwrapError: publicHydrationError(cause) };
      }
    }
  }

  return (
    <div>
      <p className="eyebrow text-primary">Documents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Rehydrate</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Step 3 of 3 — only granted slots decrypt. Upload the public bundle, then
        request rehydration — the request tx
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
      {keyError ? <p className="mt-3 text-sm text-destructive">Rehydration key error: {keyError}</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center border border-border px-2.5 text-sm">
          Upload bundle (.soulvault.json)
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
        <p className="mt-2 w-full text-xs text-muted-foreground">
          The public bundle carries the redacted text, the slot list, and the
          encrypted slots — no other file is needed. The separate
          .redacted.txt download is a plain-text copy and cannot rehydrate.
        </p>
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
            Or, for a pre-request grant, send them just your rehydration public
            key — an address alone cannot carry the wrap.
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
            {key ? (
              <Button
                variant="outline"
                onClick={() => navigator.clipboard.writeText(key.publicKey)}
                title="Send this to the author so they can grant before you post a request"
              >
                Copy rehydration public key
              </Button>
            ) : null}
          </div>
          {key ? (
            <p className="mt-2 font-mono text-xs break-all text-muted-foreground">
              key fp {key.fingerprint.slice(0, 16)}…
            </p>
          ) : null}
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
          {sessionRun ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {sessionRun === "match" ? (
                <span>Bundle matches this browser&apos;s author session (same redact run).</span>
              ) : sessionRun === "mismatch" ? (
                <span className="text-destructive">
                  Bundle is from a DIFFERENT redact run than this browser&apos;s author session — slot keys in
                  localStorage will not open this bundle. Re-export the bundle from the current session and re-upload.
                </span>
              ) : (
                <span>No author session for this document in this browser (normal for consumers).</span>
              )}
            </p>
          ) : null}
          {key ? (
            <p className="mt-1 text-xs text-muted-foreground">
              This browser&apos;s rehydration key: <span className="font-mono">{key.fingerprint.slice(0, 16)}…</span>
              {requestBindings.length > 0
                ? localKeyMatchesBinding
                  ? " — matches your on-chain request binding."
                  : " — does NOT match your on-chain request binding (see below)."
                : ""}
            </p>
          ) : null}
          {requestBindings.length > 0 && key && !localKeyMatchesBinding ? (
            <div className="mt-3 border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Rehydration key mismatch — grants cannot unwrap here</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your on-chain request{requestBindings.length > 1 ? "s" : ""} bound{" "}
                {requestBindings.map((binding, index) => (
                  <span key={index} className="font-mono">
                    {index > 0 ? ", " : ""}fp {rehydrationKeyFingerprint(binding.rehydrationPublicKey).slice(0, 12)}…
                    (block {binding.blockNumber})
                  </span>
                ))}
                {" "}but this browser holds key <span className="font-mono">{key.fingerprint.slice(0, 12)}…</span>.
                Grants are wrapped to the request&apos;s key, so unwrap fails closed (AUTHENTICATION_FAILED) —
                slot toggles will refuse to reveal.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Recovery: click “Request rehydration” to re-bind your current key on-chain, then grant again
                from the Grants tab — the newest grant per slot wins. Or open this page in the browser
                profile that holds the original key.
              </p>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {bundle.artifact.slots.map((slot) => {
              const granted = grants.some((grant) => grant.slotId === slot.slotId);
              const diag = slotDiagnostics?.get(slot.slotId);
              const suffix = !granted ? "(no grant)" : diag && !diag.ok ? (diag.stage === "slot-open" ? "(key ≠ ciphertext)" : "(wrong key)") : "";
              return (
                <Button
                  key={slot.slotId}
                  size="xs"
                  variant={revealed.has(slot.slotId) ? "default" : diag && !diag.ok ? "destructive" : "outline"}
                  disabled={!granted || !key || worldBlocking}
                  onClick={() => toggle(slot.slotId)}
                >
                  {slot.slotId} {suffix}
                </Button>
              );
            })}
          </div>
          {failedGrants.length > 0 ? (
            <div className="mt-3 border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">
                {failedGrants.length} granted slot{failedGrants.length === 1 ? "" : "s"} cannot be opened by this browser
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {failedGrants.map((grant) => {
                  const stage = slotDiagnostics?.get(grant.slotId);
                  return (
                    <li key={grant.slotId} className="font-mono">
                      {grant.slotId} —{" "}
                      {stage && !stage.ok && stage.stage === "slot-open"
                        ? "grant unwraps, but the slot key does not open this bundle (different redact run). Re-export/re-publish the bundle from the author's current session, then grant again."
                        : "grant was wrapped for a different rehydration key. Click “Request rehydration” to re-bind, then re-grant (newest grant per slot wins)."}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {grantEvents.length > 0 ? (
            <details className="mt-3 w-full border border-border bg-card p-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Grant events for this document ({grantEvents.length}) — debugging
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {grantEvents.map((grant) => {
                  const explorer = explorerTxUrl(grant.txHash, bundle.registry?.chainId);
                  return (
                    <li key={`${grant.txHash}:${grant.logIndex}`} className={grant.active ? "" : "opacity-50"}>
                      block {grant.blockNumber} ·{" "}
                      {explorer ? (
                        <a
                          className="text-primary underline decoration-dotted"
                          href={explorer}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortTx(grant.txHash)}
                        </a>
                      ) : (
                        shortTx(grant.txHash)
                      )}
                      {" "}· {grant.slotId}
                      {grant.active ? " · active" : " · superseded (newer grant exists for this slot)"}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Relevance: SlotKeyGranted events where recipient = your wallet and docHash = this bundle,
                collapsed newest-per-slot. The wrapped key rides inside the event; the newest grant per
                slot is the one that counts.
              </p>
            </details>
          ) : null}
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {view.mode === "rehydrated"
                  ? `Rehydrated text — ${grantedCount} of ${usableGrants.length} usable slot${usableGrants.length === 1 ? "" : "s"} revealed`
                  : view.mode === "error"
                    ? "Rehydrate failed — showing redacted text"
                    : "Redacted text"}
              </p>
              {grants.length > 0 && !worldBlocking && key ? (
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" onClick={revealAll} disabled={usableGrants.length === 0 || grantedCount === usableGrants.length}>
                    Reveal all granted slots
                  </Button>
                  <Button size="xs" variant="outline" onClick={hideAll} disabled={grantedCount === 0}>
                    Hide all
                  </Button>
                </div>
              ) : null}
            </div>
            {grants.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No grants delivered for this wallet yet — the author grants from
                their Grants tab; slots unlock as events land.
              </p>
            ) : null}
            {view.unwrapError ? (
              <p className="mt-1 text-sm text-destructive">
                Unwrap failed: {view.unwrapError}
                {localKeyMatchesBinding && requestBindings.length > 1
                  ? " — your key matches your latest request, but these grants may correspond to an earlier request's key; re-granting from the Grants tab overwrites (newest grant per slot wins)."
                  : ""}
              </p>
            ) : null}
            <pre
              key={[...revealed].sort().join("|")}
              className={`mt-2 whitespace-pre-wrap border p-4 font-mono text-sm ${
                view.mode === "rehydrated" ? "border-primary/40 bg-primary/5" : "border-border bg-card"
              }`}
            >
              {view.body}
            </pre>
          </div>
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
