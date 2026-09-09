/// <reference lib="webworker" />
import { analyzeText } from './analyzer.js';
import type { AnalyzeRequest, AnalyzerWorkerMessage } from './worker-protocol.js';

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { requestId, text, semanticFindings } = event.data;
  let response: AnalyzerWorkerMessage;
  try { response = { type: 'result', requestId, findings: analyzeText(text, semanticFindings) }; }
  catch { response = { type: 'error', requestId, code: 'ANALYSIS_FAILED' }; }
  self.postMessage(response);
};
