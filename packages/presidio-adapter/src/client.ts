import type { AnalyzerWorkerMessage, WorkerPort } from './worker-protocol.js';
import type { AnalyzerFinding, ReviewableFinding } from './findings.js';

export class PresidioWorkerClient {
  private requestId = 0;
  private latestRequestId = 0;
  private pending = new Map<number, { resolve: (value: ReviewableFinding[]) => void; reject: (error: Error) => void }>();
  private readonly onMessage = (event: MessageEvent<AnalyzerWorkerMessage>) => {
    const pending = this.pending.get(event.data.requestId);
    if (!pending) return;
    this.pending.delete(event.data.requestId);
    if (event.data.requestId !== this.latestRequestId) { pending.reject(new Error('STALE_ANALYSIS_RESULT')); return; }
    if (event.data.type === 'error') pending.reject(new Error(event.data.code));
    else pending.resolve(event.data.findings);
  };

  constructor(private readonly worker: WorkerPort) { worker.addEventListener('message', this.onMessage); }

  analyze(text: string, semanticFindings?: AnalyzerFinding[]) {
    const requestId = ++this.requestId;
    this.latestRequestId = requestId;
    const result = new Promise<ReviewableFinding[]>((resolve, reject) => this.pending.set(requestId, { resolve, reject }));
    this.worker.postMessage({ type: 'analyze', requestId, text, semanticFindings });
    return result;
  }

  dispose() {
    this.worker.removeEventListener('message', this.onMessage);
    for (const pending of this.pending.values()) pending.reject(new Error('ANALYZER_DISPOSED'));
    this.pending.clear();
  }
}
