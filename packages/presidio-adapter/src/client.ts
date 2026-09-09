import type {
  AnalyzerWorkerMessage,
  InferenceStatusMessage,
  ModelProgressMessage,
  ModelStatusMessage,
  ReadyMessage,
  WorkerPort,
} from './worker-protocol.js';
import type { AnalyzerFinding, ReviewableFinding } from './findings.js';

export type AnalyzeOptions = {
  semanticFindings?: AnalyzerFinding[];
  useGliner?: boolean;
};

export type PresidioWorkerListeners = {
  onReady?: (info: ReadyMessage) => void;
  onModelStatus?: (status: ModelStatusMessage) => void;
  onModelProgress?: (progress: ModelProgressMessage) => void;
  onInferenceStatus?: (status: InferenceStatusMessage) => void;
  onModelError?: (message: string) => void;
};

export class PresidioWorkerClient {
  private requestId = 0;
  private latestRequestId = 0;
  private pending = new Map<number, { resolve: (value: ReviewableFinding[]) => void; reject: (error: Error) => void }>();
  private readonly listeners: PresidioWorkerListeners;
  private readonly onMessage = (event: MessageEvent<AnalyzerWorkerMessage>) => {
    const data = event.data;
    switch (data.type) {
      case 'ready':
        this.listeners.onReady?.(data);
        return;
      case 'model-status':
        this.listeners.onModelStatus?.(data);
        return;
      case 'model-progress':
        this.listeners.onModelProgress?.(data);
        return;
      case 'inference-status':
        this.listeners.onInferenceStatus?.(data);
        return;
      case 'model-error':
        this.listeners.onModelError?.(data.message);
        return;
      case 'result':
      case 'error': {
        const pending = this.pending.get(data.requestId);
        if (!pending) return;
        this.pending.delete(data.requestId);
        if (data.requestId !== this.latestRequestId) {
          pending.reject(new Error('STALE_ANALYSIS_RESULT'));
          return;
        }
        if (data.type === 'error') pending.reject(new Error(data.code));
        else pending.resolve(data.findings);
      }
    }
  };

  constructor(private readonly worker: WorkerPort, listeners: PresidioWorkerListeners = {}) {
    this.listeners = listeners;
    worker.addEventListener('message', this.onMessage);
  }

  analyze(text: string, semanticFindingsOrOptions?: AnalyzerFinding[] | AnalyzeOptions) {
    const options: AnalyzeOptions = Array.isArray(semanticFindingsOrOptions)
      ? { semanticFindings: semanticFindingsOrOptions }
      : (semanticFindingsOrOptions ?? {});
    const requestId = ++this.requestId;
    this.latestRequestId = requestId;
    const result = new Promise<ReviewableFinding[]>((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
    this.worker.postMessage({
      type: 'analyze',
      requestId,
      text,
      semanticFindings: options.semanticFindings,
      useGliner: options.useGliner,
    });
    return result;
  }

  requestModelStatus() {
    this.worker.postMessage({ type: 'model-status' });
  }

  installModel() {
    this.worker.postMessage({ type: 'install-model' });
  }

  removeModel() {
    this.worker.postMessage({ type: 'remove-model' });
  }

  dispose() {
    this.worker.removeEventListener('message', this.onMessage);
    for (const pending of this.pending.values()) pending.reject(new Error('ANALYZER_DISPOSED'));
    this.pending.clear();
  }
}
