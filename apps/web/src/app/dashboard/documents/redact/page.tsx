"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import {
  PresidioWorkerClient,
  findingFromAuthorSpan,
  redactAcceptedFindings,
  type ReviewableFinding,
} from "@soulvault/presidio-adapter";
import { serializePublicDocumentBundle, type DocumentRegistryHint, type RedactedDocumentResult } from "@soulvault/protocol";

import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { resolveRootEnsName, resolveDocumentRegistryAddress } from "@/lib/document-registry";
import { runDocumentPublish, type WizardStep } from "@/lib/create-flows";
import { errorMessage, wizardStepFailed } from "@/lib/error-message";
import { CliRecoveryHint, DevicePromptPanel, PartialFailureNote, StepList } from "@/components/create/wizard-steps";
import { downloadText, saveSessionDocument } from "@/lib/document-session";
import { useDocumentRegistryAddress } from "@/hooks/useDocumentRegistryAddress";

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
  slotIdTouched?: boolean;
};

type MenuPos = { x: number; y: number };

const PUBLISH_STEPS: WizardStep[] = [
  { id: "resolve", label: "Resolve document registry (ENS discovery)", status: "pending" },
  { id: "publish", label: "Publish docHash + slot list on-chain", status: "pending" },
];

export default function DocumentsRedactPage() {
  const workerRef = useRef<Worker | null>(null);
  const clientRef = useRef<PresidioWorkerClient | null>(null);
  const surfaceRef = useRef<HTMLPreElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [text, setText] = useState(SAMPLE);
  const [scanned, setScanned] = useState(SAMPLE);
  const [findings, setFindings] = useState<ReviewableFinding[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSpan | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos>({ x: 16, y: 16 });
  const [result, setResult] = useState<RedactedDocumentResult | null>(null);
  const [registryHint, setRegistryHint] = useState<DocumentRegistryHint | undefined>(undefined);
  const [useGliner, setUseGliner] = useState(false);
  const [webGpu, setWebGpu] = useState(false);
  const [model, setModel] = useState({
    installed: false,
    bytes: 0,
    usage: 0,
    quota: 0,
    runtimeReady: false,
    backend: "",
  });
  const [inference, setInference] = useState<{ phase: string; message: string; backend?: string }>({
    phase: "idle",
    message: "Pattern engine ready",
  });
  const [modelProgress, setModelProgress] = useState<{ downloaded: number; total: number; file: string } | null>(null);
  const [publishSteps, setPublishSteps] = useState<WizardStep[]>(PUBLISH_STEPS);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishOutcome, setPublishOutcome] = useState<{
    registry: string;
    registrySource: string;
    txHash: string;
    blockNumber: bigint;
  } | null>(null);
  const { address, connector } = useSoulVaultWallet();

  const reviewing = findings.length > 0;
  const source = reviewing ? scanned : text;

  useEffect(() => {
    const worker = new Worker(new URL("../../../../workers/presidio.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onerror = (event) => {
      setError(event.message || "Analyzer worker failed to load");
      setWorkerReady(false);
    };
    const client = new PresidioWorkerClient(worker, {
      onReady: (info) => {
        setWorkerReady(true);
        setWebGpu(info.webGpu);
        client.requestModelStatus();
      },
      onModelStatus: (status) => {
        setModel(status);
        setModelProgress(null);
      },
      onModelProgress: (progress) => setModelProgress(progress),
      onInferenceStatus: (status) => setInference(status),
      onModelError: (message) => {
        setError(message);
        setModelProgress(null);
        setBusy(false);
      },
    });
    workerRef.current = worker;
    clientRef.current = client;
    return () => {
      client.dispose();
      worker.terminate();
      setWorkerReady(false);
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  const placeMenu = (event: { clientX: number; clientY: number }) => {
    const box = workspaceRef.current?.getBoundingClientRect();
    const x = event.clientX - (box?.left ?? 0);
    const y = event.clientY - (box?.top ?? 0);
    setMenuPos({
      x: Math.max(12, Math.min(x, (box?.width ?? 360) - 280)),
      y: Math.max(12, y + 8),
    });
  };

  const resetAnalysis = () => {
    setFindings([]);
    setAccepted(new Set());
    setDraft(null);
    setResult(null);
    setPublishSteps(PUBLISH_STEPS);
    setPublishOutcome(null);
    setPublishError(null);
    setError(null);
  };

  const scan = useCallback(async () => {
    if (!clientRef.current) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setPublishSteps(PUBLISH_STEPS);
    setPublishOutcome(null);
    setDraft(null);
    setScanned(text);
    try {
      const next = await clientRef.current.analyze(text, { useGliner });
      setFindings(next);
      setAccepted(new Set(next.map((item) => item.findingId)));
    } catch (cause) {
      if (cause instanceof Error && cause.message === "STALE_ANALYSIS_RESULT") return;
      setError(cause instanceof Error ? cause.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }, [text, useGliner]);

  function openDraft(next: DraftSpan, event?: { clientX: number; clientY: number }) {
    if (event) placeMenu(event);
    setError(null);
    setDraft(next);
  }

  function onSourceMouseUp(event: MouseEvent<HTMLPreElement>) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && surfaceRef.current?.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(surfaceRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const end = start + range.toString().length;
      if (end > start) {
        const author = findingFromAuthorSpan({
          text: source,
          start,
          end,
          entityType: "PERSON",
        });
        openDraft(
          { start, end, entityType: author.entityType, slotId: author.slotId },
          event,
        );
        return;
      }
    }
    const mark = (event.target as HTMLElement).closest("mark");
    const findingId = mark?.getAttribute("data-finding-id");
    if (!findingId) return;
    const finding = findings.find((item) => item.findingId === findingId);
    if (finding) {
      openDraft(
        {
          start: finding.start,
          end: finding.end,
          entityType: finding.entityType,
          slotId: finding.slotId,
          findingId: finding.findingId,
        },
        event,
      );
    }
  }

  function openFinding(finding: ReviewableFinding, event?: { clientX: number; clientY: number }) {
    openDraft(
      {
        start: finding.start,
        end: finding.end,
        entityType: finding.entityType,
        slotId: finding.slotId,
        findingId: finding.findingId,
      },
      event,
    );
  }

  function applyDraft() {
    if (!draft) return;
    const plaintext = source.slice(draft.start, draft.end);
    const conflict = findings.find(
      (item) =>
        item.slotId === draft.slotId &&
        item.findingId !== draft.findingId &&
        (item.entityType !== draft.entityType || source.slice(item.start, item.end) !== plaintext),
    );
    if (conflict) {
      setError("Same slotId is only allowed when entity type and exact value match.");
      return;
    }
    const next = findingFromAuthorSpan({
      text: source,
      start: draft.start,
      end: draft.end,
      entityType: draft.entityType,
      slotId: draft.slotId,
    });
    const id = draft.findingId ?? next.findingId;
    const merged: ReviewableFinding = {
      ...next,
      findingId: id,
      slotId: draft.slotId,
      source: draft.findingId ? (findings.find((item) => item.findingId === id)?.source ?? "author") : "author",
    };
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
      const finding = findings.find((item) => item.findingId === draft.findingId);
      setAccepted((current) => {
        const next = new Set(current);
        next.delete(draft.findingId!);
        return next;
      });
      if (finding?.source === "author") {
        setFindings((current) => current.filter((item) => item.findingId !== draft.findingId));
      }
    }
    setDraft(null);
  }

  async function encrypt() {
    try {
      const encrypted = redactAcceptedFindings({
        text: source,
        findings,
        acceptedFindingIds: accepted,
      });
      setResult(encrypted);
      setPublishSteps(PUBLISH_STEPS);
      setPublishOutcome(null);
      // Attach the (non-authoritative) registry hint so consumers can fall back
      // to it when ENS/env discovery is unavailable (ticket 012 §D).
      const { address: registry } = await resolveDocumentRegistryAddress();
      const config = getBrowserSoulVaultClientConfig();
      const hint = registry && config ? { chainId: config.chainId, address: registry } : undefined;
      setRegistryHint(hint);
      saveSessionDocument({
        documentId: encrypted.artifact.documentId,
        slotKeys: encrypted.slotKeys,
        bundle: serializePublicDocumentBundle(encrypted, { registry: hint }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Encrypt failed");
    }
  }

  function downloadBundle() {
    if (!result) return;
    downloadText(
      `${result.artifact.documentId.slice(0, 16)}.soulvault.json`,
      serializePublicDocumentBundle(result, { registry: registryHint }),
    );
  }

  function downloadRedacted() {
    if (!result) return;
    downloadText(
      `${result.artifact.documentId.slice(0, 16)}.redacted.txt`,
      result.artifact.content,
      "text/plain",
    );
  }

  async function publish() {
    if (!result || !address) return;
    setPublishError(null);
    setPublishOutcome(null);
    setPublishSteps(PUBLISH_STEPS);
    setPublishBusy(true);
    try {
      const outcome = await runDocumentPublish({
        from: address,
        documentId: result.artifact.documentId,
        slotIds: result.artifact.slots.map((slot) => slot.slotId),
        onStep: (stepId, update) =>
          setPublishSteps((prev) => prev.map((step) => (step.id === stepId ? { ...step, ...update } : step))),
      });
      setPublishOutcome({
        registry: outcome.registry,
        registrySource: outcome.registrySource ?? "unknown",
        txHash: outcome.txHash,
        blockNumber: outcome.blockNumber,
      });
    } catch (cause) {
      setPublishSteps((prev) => prev.map(wizardStepFailed));
      setPublishError(errorMessage(cause));
    } finally {
      setPublishBusy(false);
    }
  }

  const segments = useMemo(() => splitHighlights(source, findings), [source, findings]);
  const publishCliCommand = useMemo(() => {
    if (!result) return "";
    const registryStep = publishSteps.find((step) => step.id === "resolve");
    const registry = publishOutcome?.registry ?? (registryStep?.status === "done" ? registryStep.detail?.split(" ·")[0] : null);
    const root = resolveRootEnsName();
    const slots = result.artifact.slots.map((slot) => `--slot-id ${slot.slotId}`).join(" ");
    return (
      `pnpm soulvault document publish --doc-hash ${result.artifact.documentId} ${slots}` +
      (registry ? ` --registry ${registry}` : "") +
      ` --root-ens-name ${root}`
    );
  }, [result, publishSteps, publishOutcome]);
  const preview = useMemo(() => {
    let output = source;
    for (const item of [...findings].filter((item) => accepted.has(item.findingId)).sort((a, b) => b.start - a.start)) {
      output = `${output.slice(0, item.start)}{{sv:${item.slotId}}}${output.slice(item.end)}`;
    }
    return output;
  }, [source, findings, accepted]);

  const matchingSlots = draft
    ? uniqueSlotIds(
        findings.filter(
          (item) =>
            item.entityType === draft.entityType &&
            source.slice(item.start, item.end) === source.slice(draft.start, draft.end),
        ),
      )
    : [];

  const scanLabel = !busy
    ? "Scan locally"
    : inference.phase === "loading"
      ? "Preparing GLiNER…"
      : inference.phase === "finalizing"
        ? "Finalizing findings…"
        : "Running local detection…";
  const patternCount = findings.filter((item) => item.source === "presidio").length;
  const glinerCount = findings.filter((item) => item.source === "semantic").length;
  const authorCount = findings.filter((item) => item.source === "author").length;
  const { address: resolvedRegistry, source: registrySource } = useDocumentRegistryAddress();

  return (
    <div>
      <p className="eyebrow text-primary">Documents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Redact</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Same scan loop as{" "}
        <a
          href="https://nacmonad.github.io/presidio-web-demo/"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2 hover:underline"
        >
          presidio-web-demo
        </a>
        : source → worker → findings → redacted tokens. Engine stays in a module
        worker. Optional GLiNER runs as local ONNX in that worker. Author can
        highlight anything Presidio missed and finalize the slot id.
      </p>

      {resolvedRegistry ? (
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          registry: {resolvedRegistry}
          {registrySource ? ` · via ${registrySource}` : ""}
        </p>
      ) : (
        <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-amber-600">
          No document registry discovered — publish will fail. Deploy one on the{" "}
          <Link href="/dashboard/documents/registry" className="underline">
            Document Registry page
          </Link>
          .
        </p>
      )}

      <div
        className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border border-border bg-card px-4 py-2 font-mono text-xs text-muted-foreground"
        aria-label="Runtime status"
        aria-live="polite"
      >
        <span>
          <StatusDot ok={workerReady} /> Analysis worker
        </span>
        <span>
          <StatusDot ok={webGpu} warn={!webGpu} /> {webGpu ? "WebGPU available" : "WASM fallback"}
        </span>
        <span>
          {findings.length} detected · {accepted.size} accepted
        </span>
        <span className="ml-auto">
          <StatusDot
            ok={model.runtimeReady}
            warn={model.installed && !model.runtimeReady}
          />{" "}
          GLiNER ·{" "}
          {busy && useGliner
            ? "working"
            : model.runtimeReady
              ? `ready · ${model.backend || inference.backend}`
              : model.installed
                ? "stored offline"
                : "not installed"}
        </span>
      </div>

      <section className="mt-4 border border-border bg-card p-4">
        <p className="eyebrow text-muted-foreground">Optional enhanced detection</p>
        <h2 className="mt-2 text-sm font-semibold">GLiNER language model</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Same Knowledgator <span className="font-mono">gliner-pii-edge-v1.0</span> fp32
          model as the demo. Downloaded once into this origin&apos;s OPFS; document
          text never leaves the worker.
        </p>
        <div className="mt-3 grid gap-px border border-border bg-border sm:grid-cols-3">
          <div className="bg-background px-3 py-2">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Model</p>
            <p className="font-mono text-sm">{model.installed ? formatBytes(model.bytes) : "~180 MB"}</p>
            <p className="text-xs text-muted-foreground">{model.installed ? "Ready offline" : "Not installed"}</p>
          </div>
          <div className="bg-background px-3 py-2">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">OPFS usage</p>
            <p className="font-mono text-sm">{formatBytes(model.usage)}</p>
            <p className="text-xs text-muted-foreground">of {formatBytes(model.quota)} available</p>
          </div>
          <div className="bg-background px-3 py-2">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Runtime</p>
            <p className="font-mono text-sm">{model.backend || (webGpu ? "WebGPU" : "WASM")}</p>
            <p className="text-xs text-muted-foreground">{model.runtimeReady ? "Session loaded" : "Lazy until first GLiNER scan"}</p>
          </div>
        </div>
        {modelProgress ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Downloading {modelProgress.file} · {formatBytes(modelProgress.downloaded)}
            {modelProgress.total ? ` / ${formatBytes(modelProgress.total)}` : ""}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!model.installed ? (
            <Button
              onClick={() => {
                setError(null);
                void navigator.storage.persist().catch(() => undefined);
                clientRef.current?.installModel();
              }}
              disabled={!!modelProgress}
            >
              Install model for offline use
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setUseGliner(false);
                clientRef.current?.removeModel();
              }}
              disabled={busy}
            >
              Remove downloaded model
            </Button>
          )}
          <label className={`inline-flex items-center gap-2 text-sm ${!model.installed ? "opacity-50" : ""}`}>
            <input
              type="checkbox"
              checked={useGliner}
              disabled={!model.installed || busy}
              onChange={(event) => setUseGliner(event.target.checked)}
            />
            Use GLiNER enhanced detection
          </label>
        </div>
      </section>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <section
        ref={workspaceRef}
        className="relative mt-4 grid border border-border lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
      >
        <article className="flex min-h-[32rem] flex-col border-b border-border lg:border-r lg:border-b-0">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="eyebrow text-muted-foreground">01</span>
              <h2 className="text-sm font-semibold">Source text</h2>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{source.length.toLocaleString()} chars</span>
          </header>
          {reviewing ? (
            <pre
              ref={surfaceRef}
              onMouseUp={onSourceMouseUp}
              className="min-h-80 flex-1 whitespace-pre-wrap bg-background p-4 font-mono text-sm leading-relaxed"
              aria-label="Reviewed source text"
            >
              {segments.map((segment) =>
                segment.finding ? (
                  <mark
                    key={segment.finding.findingId}
                    data-finding-id={segment.finding.findingId}
                    className={`cursor-pointer rounded-sm ${
                      accepted.has(segment.finding.findingId) ? "bg-primary/20" : "bg-muted"
                    }`}
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={`${segment.start}-${segment.end}`}>{segment.text}</span>
                ),
              )}
            </pre>
          ) : (
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              className="min-h-80 flex-1 resize-y border-0 bg-background p-4 font-mono text-sm leading-relaxed outline-none"
              aria-label="Text to analyze"
            />
          )}
          <div className="flex flex-wrap gap-2 border-t border-border p-3">
            <Button onClick={() => void scan()} disabled={busy || !workerReady} aria-busy={busy}>
              {scanLabel}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setText(SAMPLE);
                setScanned(SAMPLE);
                resetAnalysis();
              }}
            >
              Load sample
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
                  const next = await file.text();
                  setText(next);
                  setScanned(next);
                  resetAnalysis();
                }}
              />
            </label>
            {reviewing ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setText(scanned);
                  resetAnalysis();
                }}
              >
                Edit source
              </Button>
            ) : null}
          </div>
        </article>

        <div className="grid min-h-[32rem] grid-rows-[minmax(0,1fr)_auto]">
          <article className="flex min-h-0 flex-col border-b border-border" aria-busy={busy}>
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="eyebrow text-muted-foreground">02</span>
                <h2 className="text-sm font-semibold">Findings</h2>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {findings.length} detected
                {findings.length > 0
                  ? ` · ${patternCount} rules + ${glinerCount} ML${authorCount ? ` + ${authorCount} author` : ""}`
                  : ""}
              </span>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {findings.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground" role="status" aria-live="polite">
                  {busy ? "Analyzing this text locally…" : "Run a scan to inspect locally detected PII."}
                </p>
              ) : (
                findings.map((item) => (
                  <button
                    key={item.findingId}
                    type="button"
                    onClick={(event) => openFinding(item, event)}
                    className={`flex w-full items-start justify-between gap-4 border-b border-border px-4 py-3 text-left text-xs ${
                      accepted.has(item.findingId) ? "bg-secondary/60" : "bg-background"
                    }`}
                  >
                    <span>
                      <strong className="block text-foreground">{item.entityType.replaceAll("_", " ")}</strong>
                      <code className="mt-1 block font-mono text-foreground">{source.slice(item.start, item.end)}</code>
                      <span className="mt-1 block font-mono text-muted-foreground">{item.slotId}</span>
                    </span>
                    <span className="shrink-0 text-right font-mono">
                      {Math.round(item.score * 100)}%
                      <small className="mt-1 block text-muted-foreground">
                        {item.recognizer ?? item.source ?? "Presidio"}
                      </small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </article>

          <article>
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="eyebrow text-muted-foreground">03</span>
                <h2 className="text-sm font-semibold">Redacted output</h2>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void navigator.clipboard.writeText(preview).catch(() => undefined)}
                disabled={!accepted.size}
              >
                Copy redacted text
              </Button>
            </header>
            <pre className="min-h-32 whitespace-pre-wrap p-4 font-mono text-sm leading-relaxed text-muted-foreground">
              {preview}
            </pre>
          </article>
        </div>

        {draft ? (
          <ClassifyMenu
            draft={draft}
            plaintext={source.slice(draft.start, draft.end)}
            matchingSlots={matchingSlots}
            pos={menuPos}
            onChange={setDraft}
            onAccept={applyDraft}
            onReject={rejectDraft}
            onDismiss={() => setDraft(null)}
          />
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={encrypt} disabled={accepted.size === 0}>
          Encrypt accepted slots
        </Button>
        <Button variant="outline" onClick={downloadRedacted} disabled={!result}>
          Download redacted text
        </Button>
        <Button variant="outline" onClick={downloadBundle} disabled={!result}>
          Download public bundle
        </Button>
        <Button variant="outline" onClick={() => void publish()} disabled={!result || !address || publishBusy}>
          {publishBusy ? "Publishing…" : "Publish on-chain"}
        </Button>
        <Button render={<Link href="/dashboard/documents/grants" />} variant="ghost">
          Continue to Grants
        </Button>
      </div>
      {connector === "ledger" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          On the device, expect one screen per slot plus the final approval —
          that is one signature total, sent as a single transaction. (A SoulVault
          deployer-factory contract is planned so our selectors can get Ledger
          CAL descriptors, collapsing this walk-through into a one-screen
          human-readable prompt.)
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {result ? (
        <div className="mt-6 border border-border bg-card p-4">
          <p className="eyebrow text-primary">Artifact</p>
          <p className="mt-2 font-mono text-xs break-all">
            docHash: {result.artifact.documentId}
          </p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-sm">{result.artifact.content}</pre>
          <p className="mt-3 text-xs text-muted-foreground">
            {result.slotKeys.length} slot keys in session for Grants. Not in the public file.
          </p>

          <div className="mt-4 border-t border-border pt-3">
            <DevicePromptPanel />
            <StepList steps={publishSteps} />
            {publishError ? (
              <div className="mt-3 border-l-2 border-red-600 pl-3 text-sm text-red-600">
                {publishError}
                <PartialFailureNote steps={publishSteps} />
                <CliRecoveryHint command={publishCliCommand} />
              </div>
            ) : null}
            {publishOutcome ? (
              <p className="mt-3 font-mono text-xs break-all">
                Published on {publishOutcome.registry} (via {publishOutcome.registrySource}) · tx{" "}
                <a
                  className="text-primary underline"
                  href={`https://sepolia.etherscan.io/tx/${publishOutcome.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {publishOutcome.txHash.slice(0, 10)}…
                </a>{" "}
                · block {publishOutcome.blockNumber.toString()}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusDot({ ok, warn = false }: { ok: boolean; warn?: boolean }) {
  return (
    <i
      className={`mr-1.5 inline-block size-1.5 rounded-full ${
        ok ? "bg-primary" : warn ? "bg-amber-500" : "bg-muted-foreground"
      }`}
      aria-hidden="true"
    />
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function ClassifyMenu({
  draft,
  plaintext,
  matchingSlots,
  pos,
  onChange,
  onAccept,
  onReject,
  onDismiss,
}: {
  draft: DraftSpan;
  plaintext: string;
  matchingSlots: string[];
  pos: MenuPos;
  onChange: (draft: DraftSpan) => void;
  onAccept: () => void;
  onReject: () => void;
  onDismiss: () => void;
}) {
  const preset = (ENTITY_TYPES as readonly string[]).includes(draft.entityType)
    ? draft.entityType
    : "__custom__";

  function setEntityType(entityType: string) {
    if (draft.slotIdTouched) {
      onChange({ ...draft, entityType });
      return;
    }
    const derived = findingFromAuthorSpan({
      text: plaintext,
      start: 0,
      end: plaintext.length,
      entityType,
    });
    onChange({ ...draft, entityType, slotId: derived.slotId });
  }

  return (
    <div
      role="dialog"
      aria-label="Classify span"
      className="absolute z-20 w-72 border border-border bg-popover p-3 shadow-sm"
      style={{ top: pos.y, left: pos.x }}
    >
      <p className="font-mono text-xs break-all text-foreground">{plaintext}</p>
      <label className="mt-3 block text-xs text-muted-foreground">
        Entity
        <select
          className="mt-1 block h-8 w-full border border-border bg-background px-2 text-sm"
          value={preset}
          onChange={(event) => {
            const value = event.target.value;
            setEntityType(value === "__custom__" ? "" : value);
          }}
        >
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
          <option value="__custom__">Other…</option>
        </select>
      </label>
      {preset === "__custom__" ? (
        <input
          className="mt-2 block h-8 w-full border border-border bg-background px-2 font-mono text-sm"
          placeholder="ENTITY_TYPE"
          value={draft.entityType}
          onChange={(event) => setEntityType(event.target.value.toUpperCase())}
        />
      ) : null}
      <label className="mt-3 block text-xs text-muted-foreground">
        Slot id
        <input
          className="mt-1 block h-8 w-full border border-border bg-background px-2 font-mono text-xs"
          value={draft.slotId}
          onChange={(event) => onChange({ ...draft, slotId: event.target.value, slotIdTouched: true })}
        />
      </label>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{`{{sv:${draft.slotId}}}`}</p>
      {matchingSlots.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {matchingSlots.map((slotId) => (
            <button
              key={slotId}
              type="button"
              className="border border-border px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
              onClick={() => onChange({ ...draft, slotId, slotIdTouched: true })}
            >
              reuse {slotId.slice(0, 18)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onAccept} disabled={!draft.entityType || !draft.slotId}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Close
        </Button>
      </div>
    </div>
  );
}

function uniqueSlotIds(findings: ReviewableFinding[]) {
  return [...new Set(findings.map((item) => item.slotId))];
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
