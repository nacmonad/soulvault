"use client";

import { useMemo, useState } from "react";
import { isAddressEqual, type Address, type Hex } from "viem";
import {
  createSlotKeyGrants,
  parsePublicDocumentBundle,
  type SignedRehydrationKeyAttestation,
} from "@soulvault/protocol";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { useEvents } from "@/hooks/useEvents";
import { parseDocumentEvent } from "@/lib/onchain/watcher";
import { documentRegistryAddress, grantSlotKey } from "@/lib/document-registry";
import { downloadText, loadSessionDocument } from "@/lib/document-session";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";

export default function DocumentsGrantsPage() {
  const { address } = useSoulVaultWallet();
  const { documents, status } = useDocumentEvents();
  const { events } = useEvents({ kinds: ["document"] });
  const authored = useMemo(() => {
    if (!address) return [];
    return [...documents.documents.values()].filter((doc) => isAddressEqual(doc.author, address));
  }, [address, documents]);
  const [docHash, setDocHash] = useState<Hex | "">("");
  const [attestationText, setAttestationText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<string[]>([]);

  const selectedDoc = docHash ? documents.documents.get(docHash) : undefined;
  const session = selectedDoc ? loadSessionDocument(selectedDoc.docHash) : null;
  const config = getBrowserSoulVaultClientConfig();
  const registry = documentRegistryAddress();

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
    ? events
        .map(parseDocumentEvent)
        .filter((event) => event?.eventName === "SlotKeyGranted" && event.docHash === selectedDoc.docHash)
    : [];

  async function sendGrants() {
    if (!selectedDoc || !address || !config || !registry) return;
    setError(null);
    const keys = session?.slotKeys;
    if (!keys) {
      setError("No in-session slot keys. Re-run Redact in this browser, then grant. v0 cannot re-grant after reload.");
      return;
    }
    let attestation: SignedRehydrationKeyAttestation;
    try {
      attestation = JSON.parse(attestationText) as SignedRehydrationKeyAttestation;
    } catch {
      setError("Attestation JSON is invalid.");
      return;
    }
    try {
      const grants = createSlotKeyGrants({
        slotKeys: keys,
        slotIds: [...selected],
        attestation,
        expectedChainId: config.chainId,
        expectedVerifyingContract: registry,
        now: BigInt(Math.floor(Date.now() / 1000)),
      });
      const hashes: string[] = [];
      for (const grant of grants) {
        hashes.push(
          await grantSlotKey({
            from: address,
            documentId: selectedDoc.docHash,
            slotId: grant.slotId,
            recipient: grant.recipient as Address,
            wrap: grant.wrap,
          }),
        );
      }
      setTxs(hashes);
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
        A delivered READ grant is a permanent capability. There is no revoke.
        Wrapped keys ride <span className="font-mono">SlotKeyGranted</span>. Raw
        slot keys never leave this session.
      </p>

      {status === "error" ? <p className="mt-3 text-sm text-destructive">Event config missing or scan failed.</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

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
            {selectedDoc.slotIds.map((slotId) => (
              <li key={slotId} className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-sm last:border-b-0">
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
                {slotId}
              </li>
            ))}
          </ul>
          <label className="mt-4 block text-xs text-muted-foreground">
            Recipient attestation JSON
            <textarea
              value={attestationText}
              onChange={(event) => setAttestationText(event.target.value)}
              className="mt-1 min-h-32 w-full border border-border bg-card p-3 font-mono text-xs outline-none focus:border-ring"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void sendGrants()} disabled={selected.size === 0 || !attestationText}>
              Grant selected slots
            </Button>
            <Button variant="outline" onClick={downloadBundle}>
              Download bundle
            </Button>
          </div>
          {!session ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No session keys — granting a new recipient after reload requires re-running Redact in v0.
            </p>
          ) : null}
          {txs.map((hash) => (
            <p key={hash} className="mt-2 font-mono text-xs break-all">
              {hash}
            </p>
          ))}

          <h2 className="mt-8 text-sm font-semibold">Delivered grants</h2>
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
