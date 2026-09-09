import type { DocumentSlotKey } from "@soulvault/protocol";

const prefix = "soulvault.document.";

export type SessionDocument = {
  documentId: string;
  slotKeys: DocumentSlotKey[];
  bundle: string;
};

export function saveSessionDocument(doc: SessionDocument) {
  sessionStorage.setItem(`${prefix}${doc.documentId}`, JSON.stringify(doc));
  sessionStorage.setItem(`${prefix}current`, doc.documentId);
}

export function loadSessionDocument(documentId: string): SessionDocument | null {
  const raw = sessionStorage.getItem(`${prefix}${documentId}`);
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
  return sessionStorage.getItem(`${prefix}current`);
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
