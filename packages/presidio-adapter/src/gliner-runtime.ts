import { PreTrainedTokenizer } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';
import { Gliner, type OnnxSession } from 'presidio-web';

import type { AnalyzerFinding } from './findings.js';
import type { ModelProgressMessage, ModelStatusMessage } from './worker-protocol.js';

const MODEL_DIR = 'gliner-pii-edge-v1.0';
const MODEL_VERSION = 'fp32-v1';
const MODEL_FILES = ['gliner_config.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx'] as const;
const MODEL_BASE = 'https://huggingface.co/knowledgator/gliner-pii-edge-v1.0/resolve/main';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const ORT_VERSION = '1.27.0';
const GLINER_LABELS = ['person', 'organization', 'location', 'address', 'date of birth', 'medical record number', 'username', 'passport number', 'social security number'];
const LABEL_MAP: Record<string, string> = {
  person: 'PERSON',
  organization: 'ORGANIZATION',
  location: 'LOCATION',
  address: 'ADDRESS',
  'date of birth': 'DATE_OF_BIRTH',
  'medical record number': 'MEDICAL_RECORD_NUMBER',
  username: 'USERNAME',
  'passport number': 'PASSPORT_NUMBER',
  'social security number': 'US_SSN',
};

type GlinerEntity = { label: string; start: number; end: number; score: number };

let gliner: Gliner | null = null;
let backend = '';
let loading: Promise<void> | null = null;

function ortWasmPath() {
  return new URL(`${BASE_PATH}/ort/${ORT_VERSION}/`, self.location.origin).href;
}

async function modelDirectory(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MODEL_DIR, { create });
}

async function readModelFile(path: string) {
  const segments = path.split('/');
  let directory = await modelDirectory();
  for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
  return (await directory.getFileHandle(segments.at(-1)!)).getFile();
}

export async function reportModelStatus(): Promise<ModelStatusMessage> {
  const estimate = await navigator.storage.estimate();
  let installed = false;
  let bytes = 0;
  try {
    const directory = await modelDirectory();
    const manifest = await directory.getFileHandle('manifest.json');
    const data = JSON.parse(await (await manifest.getFile()).text()) as { version: string; bytes: number };
    installed = data.version === MODEL_VERSION;
    bytes = data.bytes;
  } catch {
    /* Missing model is a normal first-run state. */
  }
  return {
    type: 'model-status',
    installed,
    bytes,
    usage: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
    runtimeReady: !!gliner,
    backend,
  };
}

export async function installModel(onProgress: (event: ModelProgressMessage) => void) {
  const directory = await modelDirectory(true);
  let downloaded = 0;
  let total = 0;
  for (const path of MODEL_FILES) {
    const response = await fetch(`${MODEL_BASE}/${path}`);
    if (!response.ok || !response.body) throw new Error(`Could not download ${path}`);
    total += Number(response.headers.get('content-length') ?? 0);
    const segments = path.split('/');
    let target = directory;
    for (const segment of segments.slice(0, -1)) target = await target.getDirectoryHandle(segment, { create: true });
    const filename = segments.at(-1)!;
    const handle = await target.getFileHandle(`${filename}.partial`, { create: true });
    const writable = await handle.createWritable();
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      downloaded += value.byteLength;
      onProgress({ type: 'model-progress', downloaded, total, file: path });
    }
    await writable.close();
    const completed = await target.getFileHandle(filename, { create: true });
    const completedWritable = await completed.createWritable();
    await completedWritable.write(await (await handle.getFile()).arrayBuffer());
    await completedWritable.close();
    await target.removeEntry(`${filename}.partial`);
  }
  const manifestHandle = await directory.getFileHandle('manifest.json', { create: true });
  const manifestWriter = await manifestHandle.createWritable();
  await manifestWriter.write(JSON.stringify({ version: MODEL_VERSION, bytes: downloaded, installedAt: new Date().toISOString() }));
  await manifestWriter.close();
}

export async function removeModel() {
  gliner = null;
  backend = '';
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(MODEL_DIR, { recursive: true });
  } catch {
    /* already absent */
  }
}

export async function loadGliner(onStatus: (message: string) => void) {
  if (gliner) return;
  if (loading) return loading;
  loading = (async () => {
    onStatus('Loading tokenizer and ONNX model…');
    const [tokenizerFile, configFile, modelFile] = await Promise.all([
      readModelFile('tokenizer.json'),
      readModelFile('tokenizer_config.json'),
      readModelFile('onnx/model.onnx'),
    ]);
    const tokenizer = new PreTrainedTokenizer(JSON.parse(await tokenizerFile.text()), JSON.parse(await configFile.text()));
    const modelBytes = new Uint8Array(await modelFile.arrayBuffer());
    ort.env.wasm.wasmPaths = ortWasmPath();
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
    let session: ort.InferenceSession;
    try {
      session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['webgpu'] });
      backend = 'WebGPU';
    } catch (webGpuError) {
      onStatus('WebGPU unavailable; compiling WASM fallback…');
      session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
      backend = 'WASM';
      console.info('GLiNER WebGPU fallback', webGpuError);
    }
    const encode = (value: string) => tokenizer(value, { add_special_tokens: false, return_tensor: false }).input_ids as number[];
    gliner = new Gliner(session as unknown as OnnxSession, encode, (type, data, dims) => new ort.Tensor(type, data, dims));
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function currentBackend() {
  return backend;
}

export async function detectGlinerEntities(text: string, onStatus: (message: string) => void): Promise<AnalyzerFinding[]> {
  await loadGliner(onStatus);
  const entities = (await gliner!.detect(text, GLINER_LABELS, { threshold: 0.5 })) as GlinerEntity[];
  return entities.map((item) => ({
    entityType: LABEL_MAP[item.label] ?? item.label.toUpperCase().replaceAll(' ', '_'),
    start: item.start,
    end: item.end,
    score: item.score,
    source: 'semantic' as const,
    recognizer: 'GLiNER',
  }));
}
