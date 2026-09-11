"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isAddressEqual, type Address, type Hex } from "viem";
import { createSlotKeyGrants, createSlotKeyGrantsForRecipient, parsePublicDocumentBundle, rehydrationKeyFingerprint } from "@soulvault/protocol";

import { Button } from "@/components/ui/button";
import { GrantWizard, type GrantWizardRequest } from "@/components/documents/grant-wizard";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { useEvents } from "@/hooks/useEvents";
import { parseDocumentEvent } from "@/lib/onchain/watcher";
import { useDocumentRegistryAddress } from "@/hooks/useDocumentRegistryAddress";
import {
  assertRecipientMatchesAttestation,
  latestRehydrationRequests,
  parsePastedAttestation,
  pendingRehydrationRequests,
  slotsFromPublicBundle,
  type PendingRehydrationRequest,
} from "@/lib/document-grants";
import { currentSessionDocumentId, downloadText, listSessionRuns, loadSessionDocument, loadSessionRunByBundle, storedSessionDocumentIds } from "@/lib/document-session";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";

export default function DocumentsGrantsPage() {
  const { address, connector } = useSoulVaultWallet();
  const { documents, status, refresh } = useDocumentEvents();
  const { events } = useEvents({ kinds: ["document"] });
  const docEvents = useMemo(
    () => events.map(parseDocumentEvent).filter((e) => e !== null),
    [events],
  );
  const authored = useMemo(() => {
    if (!address) return [];
    return [...documents.documents.values()].filter((doc) => isAddressEqual(doc.author, address));
  }, [address, documents]);
  const [docHash, setDocHash] = useState<Hex | "">("");
  const [attestationText, setAttestationText] = useState("");
  const [recipient, setRecipient] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingGrant, setPendingGrant] = useState<GrantWizardRequest | null>(null);
  // Archived redact runs exist because documentId is deterministic: re-running
  // Redact rotates slot keys under the SAME docHash. Grants must use the run
  // whose bundle the consumer actually holds, so allow switching.
  const [runBundle, setRunBundle] = useState<string | null>(null);
  // Open the wizard where the user is looking: the request row that was clicked
  // can be far below the wizard's render position at the top of the page.
  const wizardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pendingGrant) wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pendingGrant]);

  const selectedDoc = docHash ? documents.documents.get(docHash) : undefined;
  const currentSession = selectedDoc ? loadSessionDocument(selectedDoc.docHash) : null;
  const archivedRuns = selectedDoc ? listSessionRuns(selectedDoc.docHash) : [];
  const overrideRun = selectedDoc && runBundle ? loadSessionRunByBundle(selectedDoc.docHash, runBundle) : null;
  const session = overrideRun ?? currentSession;
  const sessionSlots = session ? slotsFromPublicBundle(session.bundle) : [];
  const config = getBrowserSoulVaultClientConfig();
  const { address: registry } = useDocumentRegistryAddress();
  const isAuthor = Boolean(address && selectedDoc && isAddressEqual(selectedDoc.author, address));
  // Slot keys are saved per documentId by the Redact tab. If the selected
  // document was redacted in another browser profile (or before this entry
  // existed), the keys are gone — surface which docs DO have keys so the
  // mismatch is obvious instead of a silently disabled button.
  const storedIds = useMemo(() => {
    try {
      return storedSessionDocumentIds();
    } catch {
      return [];
    }
  }, [docHash]);
  const grantDisabledReason = !session
    ? "no slot keys on this browser for this document"
    : !isAuthor
      ? "connected wallet is not the author"
      : selected.size === 0
        ? "select at least one slot"
        : null;

  useEffect(() => {
    if (docHash || authored.length === 0) return;
    const current = currentSessionDocumentId();
    if (!current) return;
    // current is bare hex (storage-normalized); doc.docHash is 0x-prefixed.
    const match = authored.find((doc) => doc.docHash.toLowerCase().replace(/^0x/, "") === current);
    if (!match) return;
    setRunBundle(null);
    setDocHash(match.docHash);
    setSelected(new Set(match.slotIds));
  }, [authored, docHash]);

  if (!address) {
    return (
      <div>
        <p className="eyebrow text-primary">Documents</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Grants</h1>
        <p className="mt-2 text-sm text-muted-foreground">Connect a wallet to grant slots.</p>
      </div>
    );
  }

  const delivered = selectedDoc
    ? events.flatMap((event) => {
        const parsed = parseDocumentEvent(event);
        return parsed?.eventName === "SlotKeyGranted" && parsed.docHash === selectedDoc.docHash ? [parsed] : [];
      })
    : [];

  const requests = selectedDoc
    ? latestRehydrationRequests(docEvents, selectedDoc.docHash)
    : [];
  const pendingAcrossDocs = useMemo(
    () => pendingRehydrationRequests(docEvents, authored.map((doc) => doc.docHash)),
    [docEvents, authored],
  );

  async function sendGrants() {
    if (!selectedDoc || !address) return;
    if (!config || !registry) {
      setError(
        registry === null && config
          ? "Document registry has not resolved yet (ENS discovery is still running or failed) — wait a moment and try again."
          : "Wallet or chain config is not ready yet — try again.",
      );
      return;
    }
    if (!isAuthor) {
      setError("Only the publishing author can grant slots.");
      return;
    }
    setError(null);
    const keys = session?.slotKeys;
    if (!keys) {
      setError("No slot keys on this browser. Re-run Redact here, then publish and grant. Keys never leave this browser profile.");
      return;
    }
    try {
      const attestation = parsePastedAttestation(attestationText);
      assertRecipientMatchesAttestation(recipient, attestation);
      const grants = createSlotKeyGrants({
        slotKeys: keys,
        slotIds: [...selected],
        attestation,
        expectedChainId: config.chainId,
        expectedVerifyingContract: registry,
        now: BigInt(Math.floor(Date.now() / 1000)),
      });
      setPendingGrant({
        docHash: selectedDoc.docHash,
        from: address,
        recipient: grants[0].recipient as Address,
        recipientKeyFingerprint: grants[0].recipientKeyFingerprint,
        grants: grants.map((grant) => ({
          slotId: grant.slotId,
          wrap: grant.wrap,
          recipient: grant.recipient as Address,
        })),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Grant failed");
    }
  }

  async function grantToRequest(request: PendingRehydrationRequest) {
    if (!selectedDoc || !address) return;
    if (!config || !registry) {
      setError(
        registry === null && config
          ? "Document registry has not resolved yet (ENS discovery is still running or failed) — wait a moment and try again."
          : "Wallet or chain config is not ready yet — try again.",
      );
      return;
    }
    if (!isAuthor) {
      setError("Only the publishing author can grant slots.");
      return;
    }
    const keys = session?.slotKeys;
    if (!keys) {
      setError("No slot keys on this browser. Re-run Redact here, then publish and grant. Keys never leave this browser profile.");
      return;
    }
    setError(null);
    try {
      const grants = createSlotKeyGrantsForRecipient({
        slotKeys: keys,
        slotIds: [...selected],
        recipient: request.recipient,
        recipientPublicKey: request.rehydrationPublicKey,
      });
      setPendingGrant({
        docHash: selectedDoc.docHash,
        from: address,
        recipient: grants[0].recipient as Address,
        recipientKeyFingerprint: grants[0].recipientKeyFingerprint,
        grants: grants.map((grant) => ({
          slotId: grant.slotId,
          wrap: grant.wrap,
          recipient: grant.recipient as Address,
        })),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Grant failed");
    }
  }

  function downloadBundle() {
    if (!session) {
      setError("Public bundle is not in this session. Redact and download from the Redact tab, or keep the file Alice already exported.");
      return;
    }
    downloadText(`${session.documentId.slice(0, 16)}.soulvault.json`, session.bundle);
    try {
      const parsed = parsePublicDocumentBundle(session.bundle);
      downloadText(`${session.documentId.slice(0, 16)}.redacted.txt`, parsed.artifact.content, "text/plain");
    } catch {
      /* bundle parse is best-effort for the text sidecar */
    }
  }

  return (
    <div>
      <p className="eyebrow text-primary">Documents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Grants</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Step 2 of 3 — you sign which slots a requester may see.
        A delivered READ grant is a permanent capability. There is no revoke.
        Wrapped keys ride <span className="font-mono">SlotKeyGranted</span>. Raw
        slot keys never leave this session.
      </p>
      {connector === "ledger" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Ledger session active — each grant tx is clear-signed on the device.
        </p>
      ) : null}

      {status === "error" ? <p className="mt-3 text-sm text-destructive">Event config missing or scan failed.</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {pendingGrant ? (
        <div ref={wizardRef}>
          <GrantWizard
            request={pendingGrant}
            onComplete={() => {
              setPendingGrant(null);
              void refresh();
            }}
            onCancel={() => setPendingGrant(null)}
          />
        </div>
      ) : null}

      {pendingAcrossDocs.length > 0 ? (
        <div className="mt-4 border border-amber-600/40 bg-amber-50 p-4 dark:border-amber-400/40 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
            {pendingAcrossDocs.length} pending rehydration request{pendingAcrossDocs.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-2">
            {pendingAcrossDocs.map((request) => (
              <li key={`${request.docHash}:${request.recipient}:${request.txHash}:${request.logIndex}`}>
                <button
                  type="button"
                  className="font-mono text-xs text-amber-700 underline decoration-dotted dark:text-amber-300"
                  onClick={() => {
                    setRunBundle(null);
                    setDocHash(request.docHash as Hex);
                    const doc = authored.find((d) => d.docHash.toLowerCase() === request.docHash.toLowerCase());
                    setSelected(new Set(doc?.slotIds ?? []));
                  }}
                >
                  {request.docHash.slice(0, 14)}… · {shortAddress(request.recipient)} · block {request.blockNumber}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-600/80 dark:text-amber-400/80">
            Click a request to select that document and grant. Requests stay listed until at least one slot grant reaches the recipient.
          </p>
        </div>
      ) : null}

      {authored.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No documents published by this wallet yet.</p>
      ) : (
        <ul className="mt-6 border border-border">
          {authored.map((doc) => (
            <li key={doc.docHash} className="flex items-center justify-between border-b border-border px-4 py-2 last:border-b-0">
              <button
                type="button"
                className={`font-mono text-xs ${docHash === doc.docHash ? "text-primary" : ""}`}
                onClick={() => {
                  setRunBundle(null);
                  setDocHash(doc.docHash);
                  setSelected(new Set(doc.slotIds));
                }}
              >
                {doc.docHash.slice(0, 18)}… · {doc.slotIds.length} slots
              </button>
              {docHash === doc.docHash ? <span className="chip text-primary">current</span> : null}
            </li>
          ))}
        </ul>
      )}

      {selectedDoc ? (
        <>
          <h2 className="mt-8 text-sm font-semibold">Slots</h2>
          <ul className="mt-2 border border-border">
            {selectedDoc.slotIds.map((slotId) => {
              const meta = sessionSlots.find((slot) => slot.slotId === slotId);
              return (
                <li key={slotId} className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selected.has(slotId)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(slotId)) next.delete(slotId);
                      else next.add(slotId);
                      setSelected(next);
                    }}
                  />
                  <span className="font-mono text-xs">{slotId}</span>
                  <span className="text-xs text-muted-foreground">{meta?.entityType ?? "—"}</span>
                  <span className="font-mono text-xs text-muted-foreground">{meta?.marker ?? `{{sv:${slotId}}}`}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {meta ? `${meta.occurrences}×` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          <h2 className="mt-8 text-sm font-semibold">Rehydration requests</h2>
          {archivedRuns.length > 0 ? (
            <details className="mt-2 border border-amber-600/40 bg-amber-50 p-3 dark:border-amber-400/40 dark:bg-amber-950/30">
              <summary className="cursor-pointer text-xs font-medium text-amber-700 dark:text-amber-300">
                {archivedRuns.length} archived redact run{archivedRuns.length === 1 ? "" : "s"} for this document — slot keys rotated on re-encrypt
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Re-running Redact reuses the docHash but generates fresh slot keys. Grants use the{" "}
                <strong>newest</strong> run unless you pick another — choose the run whose bundle the recipient
                actually holds, or their unwrap will fail (key ≠ ciphertext).
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                <li className="font-mono">
                  {session === currentSession && currentSession ? (
                    <span className="text-primary">▸ newest run (active)</span>
                  ) : null}
                </li>
                {archivedRuns.map((run) => {
                  const nonce = run.bundle.match(/"nonce":"([0-9a-f]{24})"/i)?.[1] ?? "";
                  const isActive = overrideRun?.bundle === run.bundle;
                  return (
                    <li key={run.bundle.slice(-24)} className="flex flex-wrap items-center gap-2 font-mono">
                      <span className={isActive ? "text-primary" : ""}>
                        {new Date(run.savedAt).toLocaleString()} · nonce {nonce.slice(0, 12)}…
                      </span>
                      {isActive ? (
                        <span className="chip text-primary">active for granting</span>
                      ) : (
                        <Button size="xs" variant="outline" onClick={() => setRunBundle(run.bundle)}>
                          Grant with this run
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            Consumers request on-chain from the Rehydrate tab — the request tx
            binds their wallet to their rehydration key. Select slots above,
            then grant to a request. Slots ride one batch tx when the deployed
            registry supports <span className="font-mono">grantSlotKeys</span>;
            otherwise one tx per slot.
          </p>
          {requests.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No requests in the event cache yet.</p>
          ) : (
            <ul className="mt-2 border border-border">
              {requests.map((request) => {
                const grantedCount = delivered.filter(
                  (grant) => grant.recipient.toLowerCase() === request.recipient.toLowerCase(),
                ).length;
                return (
                  <li
                    key={`${request.recipient}:${request.txHash}:${request.logIndex}`}
                    className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
                  >
                    <span className="font-mono text-xs">{shortAddress(request.recipient)}</span>
                    <span className="font-mono text-xs text-muted-foreground" title={request.rehydrationPublicKey}>
                      key fp {rehydrationKeyFingerprint(request.rehydrationPublicKey).slice(0, 12)}…
                    </span>
                    <span className="text-xs text-muted-foreground">block {request.blockNumber}</span>
                    {grantedCount > 0 ? (
                      <span className="chip">{grantedCount} granted</span>
                    ) : null}
                    <span className="ml-auto" />
                    {grantDisabledReason ? (
                      <span className="text-xs text-destructive">{grantDisabledReason}</span>
                    ) : null}
                    <span
                      title={
                        !session
                          ? "No slot keys on this browser — re-run Redact here"
                          : !isAuthor
                            ? "Only the publishing author can grant"
                            : selected.size === 0
                              ? "Select at least one slot above"
                              : undefined
                      }
                    >
                      <Button
                        size="sm"
                        disabled={busy || !isAuthor || selected.size === 0 || !session}
                        onClick={() => void grantToRequest(request)}
                      >
                        {busy ? "Granting…" : `Grant ${selected.size} slot${selected.size === 1 ? "" : "s"}`}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <details className="mt-6 border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Manual attestation (paste recipient JSON)
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Fallback for recipients who have not requested on-chain: paste the
              signed rehydration-key attestation they copied from their Rehydrate
              tab.
            </p>
            <label className="mt-4 block text-xs text-muted-foreground">
              Recipient wallet
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="0x… (optional if the attestation already names them)"
                className="mt-1 block h-8 w-full border border-border bg-background px-2 font-mono text-xs outline-none focus:border-ring"
              />
            </label>
            <label className="mt-4 block text-xs text-muted-foreground">
              Recipient attestation JSON
              <textarea
                value={attestationText}
                onChange={(event) => setAttestationText(event.target.value)}
                className="mt-1 min-h-32 w-full border border-border bg-background p-3 font-mono text-xs outline-none focus:border-ring"
              />
            </label>
            <Button
              className="mt-4"
              onClick={() => void sendGrants()}
              disabled={busy || !isAuthor || selected.size === 0 || !attestationText}
            >
              {busy
                ? connector === "ledger"
                  ? "Confirm on Ledger…"
                  : "Granting…"
                : connector === "ledger"
                  ? "Grant selected slots on Ledger"
                  : "Grant selected slots"}
            </Button>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadBundle} disabled={!selectedDoc}>
              Download bundle
            </Button>
          </div>
          {!isAuthor ? (
            <p className="mt-3 text-xs text-muted-foreground">Only the publishing author can enable the grant action.</p>
          ) : null}
          {!session ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No slot keys on this browser — granting needs the key material saved by Redact on this profile. Re-run Redact here, then publish and grant.
              {storedIds.length > 0 ? (
                <>
                  {" "}
                  Keys <em>are</em> stored here for{" "}
                  <span className="font-mono">
                    {storedIds.map((id) => `${id.slice(0, 10)}…`).join(", ")}
                  </span>{" "}
                  — none matches the selected document ({selectedDoc.docHash.replace(/^0x/, "").slice(0, 10)}…). Pick that document above, or re-run Redact to regenerate it.
                </>
              ) : null}
            </p>
          ) : null}

          <h2 className="mt-8 text-sm font-semibold">Delivered grants</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A delivered READ grant is a permanent capability. Event log shows slotId, recipient, tx — never wrap material.
          </p>
          {delivered.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None in the event cache yet.</p>
          ) : (
            <ul className="mt-2 border border-border">
              {delivered.map((grant) => (
                <li key={`${grant.docHash}:${grant.slotId}:${grant.txHash}`} className="px-4 py-2 font-mono text-xs">
                  {grant.slotId} → {shortAddress(grant.recipient)} · {grant.txHash.slice(0, 12)}…
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
