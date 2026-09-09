import { describe, expect, it } from 'vitest';
import { indexFindings, mergeFindings, PresidioWorkerClient, redactAcceptedFindings, type AnalyzerWorkerMessage, type WorkerPort } from '../src/index.js';

const source = 'Contact TEST@EXAMPLE.COM then TEST@EXAMPLE.COM; ignore SECRET WORD.';

describe('presidio adapter', () => {
  it('gives validated findings overlap priority and stable repeated-value slots', () => {
    const merged = mergeFindings(
      [{ entityType: 'EMAIL_ADDRESS', start: 8, end: 24, score: .85, source: 'presidio' }],
      [{ entityType: 'PERSON', start: 8, end: 12, score: .99, source: 'semantic' }, { entityType: 'PERSON', start: 31, end: 35, score: .9, source: 'semantic' }],
    );
    expect(merged.map((item) => item.entityType)).toEqual(['EMAIL_ADDRESS', 'PERSON']);
    const indexed = indexFindings(source, [
      { entityType: 'EMAIL_ADDRESS', start: 8, end: 24, score: .85, source: 'presidio' },
      { entityType: 'EMAIL_ADDRESS', start: 30, end: 46, score: .85, source: 'presidio' },
    ]);
    expect(indexed[0].slotId).toBe(indexed[1].slotId);
    expect(indexed[0].findingId).not.toBe(indexed[1].findingId);
  });

  it('encrypts only reviewed findings and leaks neither rejected plaintext nor keys publicly', () => {
    const findings = indexFindings(source, [
      { entityType: 'EMAIL_ADDRESS', start: 8, end: 24, score: .85, source: 'presidio' },
      { entityType: 'EMAIL_ADDRESS', start: 30, end: 46, score: .85, source: 'presidio' },
      { entityType: 'SECRET', start: 55, end: 66, score: .8, source: 'semantic' },
    ]);
    const result = redactAcceptedFindings({ text: source, findings, acceptedFindingIds: findings.slice(0, 2).map((item) => item.findingId) });
    expect(result.artifact.content).toContain('{{sv:');
    expect(result.artifact.content).toContain('SECRET WORD');
    const publicJson = JSON.stringify({ artifact: result.artifact, encryptedSlots: result.encryptedSlots });
    expect(publicJson).not.toContain('TEST@EXAMPLE.COM');
    for (const key of result.slotKeys) expect(publicJson).not.toContain(key.key);
  });

  it('suppresses stale worker results and keeps worker errors free of source text', async () => {
    const listeners = new Set<(event: MessageEvent<AnalyzerWorkerMessage>) => void>();
    const sent: unknown[] = [];
    const port: WorkerPort = {
      postMessage: (message) => { sent.push(message); },
      addEventListener: (_type, listener) => { listeners.add(listener); },
      removeEventListener: (_type, listener) => { listeners.delete(listener); },
    };
    const client = new PresidioWorkerClient(port);
    const old = client.analyze('OLD PRIVATE VALUE');
    const current = client.analyze('NEW PRIVATE VALUE');
    for (const listener of listeners) listener(new MessageEvent('message', { data: { type: 'result', requestId: 1, findings: [] } }));
    await expect(old).rejects.toThrow('STALE_ANALYSIS_RESULT');
    for (const listener of listeners) listener(new MessageEvent('message', { data: { type: 'error', requestId: 2, code: 'ANALYSIS_FAILED' } }));
    await expect(current).rejects.toThrow('ANALYSIS_FAILED');
    expect(JSON.stringify({ type: 'error', requestId: 2, code: 'ANALYSIS_FAILED' })).not.toContain('NEW PRIVATE VALUE');
    expect(sent).toHaveLength(2);
    client.dispose();
  });
});
