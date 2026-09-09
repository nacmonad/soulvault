import type { DocumentSlotKey } from "@soulvault/protocol";

const prefix = "soulvault.document.";

export type SessionDocument = {
  documentId: string;
  slotKeys: DocumentSlotKey[];
};

export function saveSessionDocument(doc: SessionDocument) {
  sessionStorage.setItem(`${prefix}${doc.documentId}`, JSON.stringify(doc.slotKeys));
  sessionStorage.setItem(`${prefix}current`, doc.documentId);
}

export function loadSessionDocument(documentId: string): DocumentSlotKey[] | null {
  const raw = sessionStorage.getItem(`${prefix}${documentId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DocumentSlotKey[];
  } catch {
    return null;
  }
}

export function currentSessionDocumentId(): string | null {
  return sessionStorage.getItem(`${prefix}current`);
}
