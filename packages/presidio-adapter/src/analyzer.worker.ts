/// <reference lib="webworker" />

import { analyzePatterns } from './analyzer.js';
import { indexFindings, mergeFindings } from './findings.js';
import { detectGlinerEntities, installModel, removeModel, reportModelStatus, currentBackend } from './gliner-runtime.js';
import { expandSemanticOccurrences } from './semantic-occurrences.js';
import type { AnalyzerFinding } from './findings.js';
import type { AnalyzerWorkerMessage, WorkerRequest } from './worker-protocol.js';

declare const self: DedicatedWorkerGlobalScope;

function post(message: AnalyzerWorkerMessage) {
  self.postMessage(message);
}

function inference(phase: string, message: string) {
  post({ type: 'inference-status', phase, message, backend: currentBackend() });
}

async function analyze(text: string, useGliner: boolean, requestId: number, extraSemantic: AnalyzerFinding[] = []) {
  const started = performance.now();
  inference('scanning', useGliner ? 'Running Presidio + GLiNER…' : 'Running Presidio patterns…');
  const patterns = analyzePatterns(text);
  let semantic = extraSemantic;
  if (useGliner) {
    const detected = await detectGlinerEntities(text, (message) => inference('loading', message));
    const accepted = mergeFindings(patterns, detected).filter((item) => item.source === 'semantic');
    semantic = [...extraSemantic, ...expandSemanticOccurrences(text, accepted)];
  }
  inference('finalizing', 'Finalizing findings…');
  const findings = indexFindings(text, mergeFindings(patterns, semantic));
  const elapsedMs = performance.now() - started;
  post({
    type: 'result',
    requestId,
    findings,
    patternCount: patterns.length,
    glinerCount: semantic.length,
    elapsedMs,
    backend: currentBackend(),
  });
  inference('complete', `Scan complete · ${(elapsedMs / 1000).toFixed(1)}s${currentBackend() ? ` · ${currentBackend()}` : ''}`);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  try {
    if (data.type === 'analyze') {
      await analyze(data.text, Boolean(data.useGliner), data.requestId, data.semanticFindings);
    } else if (data.type === 'model-status') {
      post(await reportModelStatus());
    } else if (data.type === 'install-model') {
      await installModel((progress) => post(progress));
      post(await reportModelStatus());
    } else if (data.type === 'remove-model') {
      await removeModel();
      post(await reportModelStatus());
    }
  } catch {
    if (data.type === 'analyze') post({ type: 'error', requestId: data.requestId, code: 'ANALYSIS_FAILED' });
    post({ type: 'model-error', message: data.type === 'analyze' ? 'ANALYSIS_FAILED' : 'MODEL_OPERATION_FAILED' });
    inference('error', data.type === 'analyze' ? 'GLiNER failed' : 'Model operation failed');
  }
};

post({ type: 'ready', webGpu: 'gpu' in navigator });
