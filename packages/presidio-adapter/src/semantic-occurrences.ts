import type { AnalyzerFinding } from './findings.js';

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

/**
 * Once GLiNER establishes that an exact value is sensitive, propagate that finding to
 * every other whole-token occurrence. Port of presidio-web-demo `expandSemanticOccurrences`.
 */
export function expandSemanticOccurrences<T extends AnalyzerFinding>(text: string, findings: T[]): T[] {
  const expanded = [...findings];
  const seen = new Set(findings.map((item) => `${item.entityType}\0${item.start}\0${item.end}`));
  const seeds = new Map<string, T>();

  for (const finding of findings) {
    const value = text.slice(finding.start, finding.end);
    if (!value) continue;
    const key = `${finding.entityType}\0${value}`;
    const current = seeds.get(key);
    if (!current || finding.score > current.score) seeds.set(key, finding);
  }

  for (const seed of seeds.values()) {
    const value = text.slice(seed.start, seed.end);
    const startsWithWord = WORD_CHARACTER.test([...value][0] ?? '');
    const endsWithWord = WORD_CHARACTER.test([...value].at(-1) ?? '');
    const matches = text.matchAll(new RegExp(value.replace(REGEX_SPECIAL, '\\$&'), 'gu'));

    for (const match of matches) {
      const start = match.index;
      const end = start + value.length;
      const previous = [...text.slice(0, start)].at(-1);
      const next = [...text.slice(end)][0];
      if (startsWithWord && previous && WORD_CHARACTER.test(previous)) continue;
      if (endsWithWord && next && WORD_CHARACTER.test(next)) continue;

      const spanKey = `${seed.entityType}\0${start}\0${end}`;
      if (seen.has(spanKey)) continue;
      seen.add(spanKey);
      expanded.push({
        ...seed,
        start,
        end,
        recognizer: 'GLiNER exact match',
      });
    }
  }

  return expanded;
}
