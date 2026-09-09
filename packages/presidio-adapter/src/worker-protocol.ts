import type { AnalyzerFinding, ReviewableFinding } from './findings.js';

export type AnalyzeRequest = { type: 'analyze'; requestId: number; text: string; semanticFindings?: AnalyzerFinding[] };
export type AnalyzeResult = { type: 'result'; requestId: number; findings: ReviewableFinding[] };
export type AnalyzeError = { type: 'error'; requestId: number; code: 'ANALYSIS_FAILED' };
export type AnalyzerWorkerMessage = AnalyzeResult | AnalyzeError;

export interface WorkerPort {
  postMessage(message: AnalyzeRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<AnalyzerWorkerMessage>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<AnalyzerWorkerMessage>) => void): void;
}
