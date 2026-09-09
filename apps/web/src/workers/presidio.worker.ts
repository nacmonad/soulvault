/// <reference lib="webworker" />

import { analyzeText } from "@soulvault/presidio-adapter/analyzer";
import type { AnalyzeRequest, AnalyzerWorkerMessage } from "@soulvault/presidio-adapter";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { requestId, text, semanticFindings } = event.data;
  let response: AnalyzerWorkerMessage;
  try {
    response = { type: "result", requestId, findings: analyzeText(text, semanticFindings) };
  } catch {
    response = { type: "error", requestId, code: "ANALYSIS_FAILED" };
  }
  self.postMessage(response);
};
