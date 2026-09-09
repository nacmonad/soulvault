"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PresidioWorkerClient,
  findingFromAuthorSpan,
  redactAcceptedFindings,
  type ReviewableFinding,
} from "@soulvault/presidio-adapter";
import { serializePublicDocumentBundle, type RedactedDocumentResult } from "@soulvault/protocol";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { publishDocument } from "@/lib/document-registry";
import { downloadText, saveSessionDocument } from "@/lib/document-session";

const SAMPLE = `Patient Sarah Connor called from +1 415-555-2671.
Her bank transfer used IBAN DE89370400440532013000.
Sarah Connor confirmed the same callback number: +1 415-555-2671.
Backup card: 4111 1111 1111 1111. Email: sarah.connor@example.com.`;

const ENTITY_TYPES = [
  "PERSON",
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "US_SSN",
  "CREDIT_CARD",
  "MEDICATION",
  "IBAN_CODE",
] as const;

type DraftSpan = {
  start: number;
  end: number;
  entityType: string;
  slotId: string;
  findingId?: string;
};

export default function DocumentsRedactPage() {
  const workerRef = useRef<Worker | null>(null);
  const clientRef = useRef<PresidioWorkerClient | null>(null);
  const snapshotRef = useRef(SAMPLE);
  const surfaceRef = useRef<HTMLPreElement | null>(null);
  const [text, setText] = useState(SAMPLE);
  const [findings, setFindings] = useState<ReviewableFinding[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSpan | null>(null);
  const [result, setResult] = useState<RedactedDocumentResult | null>(null);
  const [publishTx, setPublishTx] = useState<string | null>(null);
  const { address } = useSoulVaultWallet();

  useEffect(() => {
    const worker = new Worker(new URL("../../../../workers/presidio.worker.ts", import.meta.url), {
      type: "module",
    });
    const client = new PresidioWorkerClient(worker);
    workerRef.current = worker;
    clientRef.current = client;
    return () => {
      client.dispose();
      worker.terminate();
    };
  }, []);

  const scan = useCallback(async () => {
    if (!clientRef.current) return;
    setBusy(true);
    setError(null);
    setResult(null);
    snapshotRef.current = text;
    try {
      const next = await clientRef.current.analyze(text);
      setFindings(next);
      setAccepted(new Set());
    } catch (cause) {
      if (cause instanceof Error && cause.message === "STALE_ANALYSIS_RESULT") return;
      setError(cause instanceof Error ? cause.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }, [text]);

  const source = snapshotRef.current;

  function onSelect() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !surfaceRef.current) return;
    if (!surfaceRef.current.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(surfaceRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    if (end <= start) return;
    const author = findingFromAuthorSpan({
      text: source,
      start,
      end,
      entityType: "PERSON",
    });
    setDraft({
      start,
      end,
      entityType: author.entityType,
      slotId: author.slotId,
    });
  }

  function openFinding(finding: ReviewableFinding) {
    setDraft({
      start: finding.start,
      end: finding.end,
      entityType: finding.entityType,
      slotId: finding.slotId,
      findingId: finding.findingId,
    });
  }

  function applyDraft() {
    if (!draft) return;
    const next = findingFromAuthorSpan({
      text: source,
      start: draft.start,
      end: draft.end,
      entityType: draft.entityType,
      slotId: draft.slotId,
    });
    const id = draft.findingId ?? next.findingId;
    const merged: ReviewableFinding = { ...next, findingId: id, slotId: draft.slotId };
    setFindings((current) => {
      const without = current.filter(
        (item) => item.findingId !== id && !(item.start === merged.start && item.end === merged.end),
      );
      return [...without, merged].sort((a, b) => a.start - b.start);
    });
    setAccepted((current) => new Set(current).add(id));
    setDraft(null);
    window.getSelection()?.removeAllRanges();
  }

  function rejectDraft() {
    if (!draft) return;
    if (draft.findingId) {
      setAccepted((current) => {
        const next = new Set(current);
        next.delete(draft.findingId!);
        return next;
      });
    }
    setDraft(null);
  }

  function encrypt() {
    try {
      const encrypted = redactAcceptedFindings({
        text: source,
        findings,
        acceptedFindingIds: accepted,
      });
      setResult(encrypted);
      setPublishTx(null);
      saveSessionDocument({
        documentId: encrypted.artifact.documentId,
        slotKeys: encrypted.slotKeys,
        bundle: serializePublicDocumentBundle(encrypted),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Encrypt failed");
    }
  }

  function downloadBundle() {
    if (!result) return;
    downloadText(
      `${result.artifact.documentId.slice(0, 16)}.soulvault.json`,
      serializePublicDocumentBundle(result),
    );
  }

  async function publish() {
    if (!result || !address) return;
    setError(null);
    try {
      const hash = await publishDocument({
        from: address,
        documentId: result.artifact.documentId,
        slotIds: result.artifact.slots.map((slot) => slot.slotId),
      });
      setPublishTx(hash);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publish failed");
    }
  }

  const segments = useMemo(() => splitHighlights(source, findings), [source, findings]);

  return (
    <div>
      <p className="eyebrow text-primary">Documents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Redact</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Scan locally, then highlight anything else. Classify and finalize the slot
        id. Only accepted spans enter the secret key bundle.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => void scan()} disabled={busy}>
          {busy ? "Scanning…" : "Scan locally"}
        </Button>
        <label className="inline-flex h-8 cursor-pointer items-center border border-border px-2.5 text-sm">
          Open file
          <input
            type="file"
            accept=".txt,.md,.json,.csv,text/*"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setText(await file.text());
              setFindings([]);
              setAccepted(new Set());
              setResult(null);
            }}
          />
        </label>
        <Button variant="outline" onClick={() => { setText(SAMPLE); setFindings([]); setAccepted(new Set()); setResult(null); }}>
          Load sample
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {findings.length === 0 ? (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          className="mt-6 min-h-48 w-full border border-border bg-card p-4 font-mono text-sm outline-none focus:border-ring"
          aria-label="Source text"
        />
      ) : (
        <pre
          ref={surfaceRef}
          onMouseUp={onSelect}
          className="mt-6 min-h-48 w-full whitespace-pre-wrap border border-border bg-card p-4 font-mono text-sm"
        >
          {segments.map((segment) =>
            segment.finding ? (
              <mark
                key={`${segment.finding.findingId}`}
                className={`cursor-pointer ${accepted.has(segment.finding.findingId) ? "bg-primary/25" : "bg-muted"}`}
                onClick={() => openFinding(segment.finding!)}
              >
                {segment.text}
              </mark>
            ) : (
              <span key={`${segment.start}-${segment.end}`}>{segment.text}</span>
            ),
          )}
        </pre>
      )}

      {draft ? (
        <div className="mt-4 border border-border bg-card p-4">
          <p className="eyebrow text-primary">Classify span</p>
          <p className="mt-2 font-mono text-sm">{source.slice(draft.start, draft.end)}</p>
          <label className="mt-3 block text-xs text-muted-foreground">
            Entity
            <select
              className="mt-1 block h-8 w-full border border-border bg-background px-2 text-sm"
              value={draft.entityType}
              onChange={(event) => {
                const entityType = event.target.value;
                const derived = findingFromAuthorSpan({
                  text: source,
                  start: draft.start,
                  end: draft.end,
                  entityType,
                });
                setDraft({ ...draft, entityType, slotId: derived.slotId });
              }}
            >
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-xs text-muted-foreground">
            Slot id
            <input
              className="mt-1 block h-8 w-full border border-border bg-background px-2 font-mono text-sm"
              value={draft.slotId}
              onChange={(event) => setDraft({ ...draft, slotId: event.target.value })}
            />
          </label>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{`{{sv:${draft.slotId}}}`}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={applyDraft}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={rejectDraft}>
              Reject
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={encrypt} disabled={accepted.size === 0}>
          Encrypt accepted slots
        </Button>
        <Button variant="outline" onClick={downloadBundle} disabled={!result}>
          Download public bundle
        </Button>
        <Button variant="outline" onClick={() => void publish()} disabled={!result || !address}>
          Publish on-chain
        </Button>
        <Button render={<Link href="/dashboard/documents/grants" />} variant="ghost" disabled={!result}>
          Continue to Grants
        </Button>
      </div>

      {result ? (
        <div className="mt-6 border border-border bg-card p-4">
          <p className="eyebrow text-primary">Artifact</p>
          <p className="mt-2 font-mono text-xs break-all">{result.artifact.documentId}</p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-sm">{result.artifact.content}</pre>
          <p className="mt-3 text-xs text-muted-foreground">
            {result.slotKeys.length} slot keys in session for Grants. Not in the public file.
            Reload requires re-redact before granting to a new recipient.
          </p>
          {publishTx ? <p className="mt-2 font-mono text-xs break-all">published {publishTx}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function splitHighlights(text: string, findings: ReviewableFinding[]) {
  const ordered = [...findings].sort((a, b) => a.start - b.start);
  const parts: { start: number; end: number; text: string; finding?: ReviewableFinding }[] = [];
  let cursor = 0;
  for (const finding of ordered) {
    if (finding.start < cursor) continue;
    if (finding.start > cursor) {
      parts.push({ start: cursor, end: finding.start, text: text.slice(cursor, finding.start) });
    }
    parts.push({
      start: finding.start,
      end: finding.end,
      text: text.slice(finding.start, finding.end),
      finding,
    });
    cursor = finding.end;
  }
  if (cursor < text.length) parts.push({ start: cursor, end: text.length, text: text.slice(cursor) });
  return parts;
}
