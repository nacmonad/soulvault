import { redactAndEncryptDocument, type RedactedDocumentResult } from '@soulvault/protocol';

export type AnalyzerFinding = {
  entityType: string;
  start: number;
  end: number;
  score: number;
  source: 'presidio' | 'semantic';
  recognizer?: string;
};

export type ReviewableFinding = AnalyzerFinding & { findingId: string; slotId: string };

const overlaps = (a: AnalyzerFinding, b: AnalyzerFinding) => a.start < b.end && a.end > b.start;

/** Validated pattern/checksum findings always win overlap conflicts. */
export function mergeFindings(patterns: AnalyzerFinding[], semantic: AnalyzerFinding[]) {
  const deterministic = [...patterns].sort((a, b) => a.start - b.start || b.score - a.score || a.end - b.end);
  const accepted = [...deterministic];
  for (const candidate of [...semantic].sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (!deterministic.some((item) => overlaps(candidate, item)) && !accepted.some((item) => overlaps(candidate, item))) {
      accepted.push(candidate);
    }
  }
  return accepted.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function normalizeEntityValue(entityType: string, value: string) {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (entityType === 'PHONE_NUMBER') return `${normalized.startsWith('+') ? '+' : ''}${normalized.replace(/\D/g, '')}`;
  if (entityType === 'EMAIL_ADDRESS') {
    const at = normalized.lastIndexOf('@');
    return at < 0 ? normalized : `${normalized.slice(0, at)}@${normalized.slice(at + 1).toLowerCase()}`;
  }
  return normalized;
}

function hashIdentity(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

export function indexFindings(text: string, findings: AnalyzerFinding[]): ReviewableFinding[] {
  return findings.map((finding, occurrence) => {
    const identity = `${finding.entityType}\0${normalizeEntityValue(finding.entityType, text.slice(finding.start, finding.end))}`;
    const slotId = `pii-${finding.entityType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hashIdentity(identity)}`;
    return { ...finding, slotId, findingId: `${slotId}:${finding.start}:${finding.end}:${occurrence}` };
  });
}

export function redactAcceptedFindings(input: {
  text: string;
  findings: ReviewableFinding[];
  acceptedFindingIds: Iterable<string>;
  random?: (length: number) => Uint8Array;
}): RedactedDocumentResult {
  const accepted = new Set(input.acceptedFindingIds);
  return redactAndEncryptDocument({
    text: input.text,
    spans: input.findings.filter((item) => accepted.has(item.findingId)).map(({ start, end, entityType, slotId }) => ({ start, end, entityType, slotId })),
    random: input.random,
  });
}
