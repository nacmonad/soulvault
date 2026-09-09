import type { AnalyzerFinding, ReviewableFinding } from './findings.js';

export type AnalyzeRequest = {
  type: 'analyze';
  requestId: number;
  text: string;
  semanticFindings?: AnalyzerFinding[];
  useGliner?: boolean;
};
export type ModelStatusRequest = { type: 'model-status' };
export type InstallModelRequest = { type: 'install-model' };
export type RemoveModelRequest = { type: 'remove-model' };
export type WorkerRequest = AnalyzeRequest | ModelStatusRequest | InstallModelRequest | RemoveModelRequest;

export type AnalyzeResult = {
  type: 'result';
  requestId: number;
  findings: ReviewableFinding[];
  patternCount?: number;
  glinerCount?: number;
  elapsedMs?: number;
  backend?: string;
};
export type AnalyzeError = { type: 'error'; requestId: number; code: 'ANALYSIS_FAILED' };
export type ReadyMessage = { type: 'ready'; webGpu: boolean };
export type ModelStatusMessage = {
  type: 'model-status';
  installed: boolean;
  bytes: number;
  usage: number;
  quota: number;
  runtimeReady: boolean;
  backend: string;
};
export type ModelProgressMessage = { type: 'model-progress'; downloaded: number; total: number; file: string };
export type InferenceStatusMessage = { type: 'inference-status'; phase: string; message: string; backend?: string };
export type ModelErrorMessage = { type: 'model-error'; message: string };

export type AnalyzerWorkerMessage =
  | AnalyzeResult
  | AnalyzeError
  | ReadyMessage
  | ModelStatusMessage
  | ModelProgressMessage
  | InferenceStatusMessage
  | ModelErrorMessage;

export interface WorkerPort {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<AnalyzerWorkerMessage>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<AnalyzerWorkerMessage>) => void): void;
}
