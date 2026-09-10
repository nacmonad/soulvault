import type { DocumentSlotKey } from "@soulvault/protocol";

const prefix = "soulvault.document.";
const runsSuffix = ".runs";
const MAX_ARCHIVED_RUNS = 10;

export type SessionRun = {
  savedAt: number;
  slotKeys: DocumentSlotKey[];
  bundle: string;
};

export type SessionDocument = {
  documentId: string;
  slotKeys: DocumentSlotKey[];
  bundle: string;
};

// Slot keys live in localStorage (per-origin, survives reloads and server
// restarts) rather than sessionStorage — a grant for an already-published
// docHash is impossible to re-derive: the keys are the only copy of the PII
// wrap material, so losing them bricks rehydration requests for that document.
// Tradeoff: raw keys at rest in the browser. Acceptable for v0 demo scope;
// a wallet-derived KEK should wrap them before any real-data use.
// Protocol artifact documentIds are bare hex ("c9cd…"), while on-chain
// docHash values are 0x-prefixed viem Hex. Storage keys always use the bare
// lowercase form — normalize on every read/write so both callers match.
//
// documentId is deterministic over the PUBLIC artifact (redacted content +
// slot list), so re-running Redact on the same source reuses it while every
// slot key, nonce, and ciphertext rotates. Overwriting the session would
// destroy the previous run's keys — the only wrap material for bundles
// already published under that docHash — so previous runs are archived under
// `<docId>.runs` instead of being dropped.
function normalizeDocumentId(id: string): string {
  return (id.startsWith("0x") ? id.slice(2) : id).toLowerCase();
}

function runsStorageKey(documentId: string): string {
  return `${prefix}${normalizeDocumentId(documentId)}${runsSuffix}`;
}

function isSessionRun(value: unknown): value is SessionRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<SessionRun>;
  return (
    typeof run.savedAt === "number" &&
    Array.isArray(run.slotKeys) &&
    typeof run.bundle === "string"
  );
}

function readRuns(documentId: string): SessionRun[] {
  try {
    const raw = localStorage.getItem(runsStorageKey(documentId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isSessionRun) : [];
  } catch {
    return [];
  }
}

function writeRuns(documentId: string, runs: SessionRun[]): void {
  localStorage.setItem(runsStorageKey(documentId), JSON.stringify(runs.slice(0, MAX_ARCHIVED_RUNS)));
}

export function saveSessionDocument(doc: SessionDocument) {
  const key = `${prefix}${normalizeDocumentId(doc.documentId)}`;
  const existing = loadSessionDocument(doc.documentId);
  if (existing && existing.bundle !== doc.bundle) {
    const runs = readRuns(doc.documentId).filter((run) => run.bundle !== existing.bundle);
    // Newest first; cap keeps a long demo session from growing unbounded.
    writeRuns(doc.documentId, [{ savedAt: Date.now(), slotKeys: existing.slotKeys, bundle: existing.bundle }, ...runs]);
  }
  localStorage.setItem(`${prefix}${normalizeDocumentId(doc.documentId)}`, JSON.stringify(doc));
  localStorage.setItem(`${prefix}current`, normalizeDocumentId(doc.documentId));
}

export function loadSessionDocument(documentId: string): SessionDocument | null {
  const key = `${prefix}${normalizeDocumentId(documentId)}`;
  const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionDocument>;
    if (!parsed.documentId || !Array.isArray(parsed.slotKeys) || typeof parsed.bundle !== "string") {
      return null;
    }
    return parsed as SessionDocument;
  } catch {
    return null;
  }
}

export function currentSessionDocumentId(): string | null {
  const id = localStorage.getItem(`${prefix}current`) ?? sessionStorage.getItem(`${prefix}current`);
  return id ? normalizeDocumentId(id) : null;
}

// Archived redact runs for a documentId, newest first. The current (latest)
// session is NOT in this list — it lives under `<docId>` itself.
export function listSessionRuns(documentId: string): SessionRun[] {
  try {
    return readRuns(documentId);
  } catch {
    return [];
  }
}

// Session holding the exact bundle string — the archived run whose bundle
// matches what was published (consumers hold that file). Falls back to the
// current session only when no archived run matches.
export function loadSessionRunByBundle(documentId: string, bundle: string): SessionDocument | null {
  const run = readRuns(documentId).find((entry) => entry.bundle === bundle);
  if (run) {
    return { documentId: normalizeDocumentId(documentId), slotKeys: run.slotKeys, bundle: run.bundle };
  }
  const current = loadSessionDocument(documentId);
  return current && current.bundle === bundle ? current : null;
}

// Diagnostic aid for the grants page: which documents actually have key
// material on this browser. Surfaces docHash mismatches (keys saved for a
// different redact run than the published doc being granted).
export function storedSessionDocumentIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix) && key !== `${prefix}current` && !key.endsWith(runsSuffix)) {
      ids.push(normalizeDocumentId(key.slice(prefix.length)));
    }
  }
  return ids;
}

export function downloadText(filename: string, body: string, type = "application/json") {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
