import type { DocumentSlotKey } from "@soulvault/protocol";

const prefix = "soulvault.document.";

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
function normalizeDocumentId(id: string): string {
  return (id.startsWith("0x") ? id.slice(2) : id).toLowerCase();
}

export function saveSessionDocument(doc: SessionDocument) {
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

// Diagnostic aid for the grants page: which documents actually have key
// material on this browser. Surfaces docHash mismatches (keys saved for a
// different redact run than the published doc being granted).
export function storedSessionDocumentIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix) && key !== `${prefix}current`) {
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
