// MediaPipe stays here; the rest of the app receives plain hand landmarks.
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { config } from './config';
import type { HandFrame } from './types';

const LOCAL_MODEL = '/models/hand_landmarker.task';
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export type HandTracker = {
  detect(video: HTMLVideoElement, t: number): HandFrame[] | Promise<HandFrame[]>;
  inferenceMs?: number;
  close(): void;
};
type TrackerResult = { recognizer: HandTracker; delegate: 'GPU' | 'CPU'; backend?: 'worker' | 'main' };

async function localModelExists(): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    // Vite serves HTML for a missing asset.
    return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export async function createRecognizer(signal?: AbortSignal): Promise<TrackerResult> {
  const modelAssetPath = (await localModelExists()) ? LOCAL_MODEL : REMOTE_MODEL;
  if (signal?.aborted) throw new DOMException('Tracker startup cancelled', 'AbortError');
  if (typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    try { return await createWorkerRecognizer(modelAssetPath, signal); }
    catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[gestures] Worker unavailable; using main thread', error);
    }
  }
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  if (signal?.aborted) throw new DOMException('Tracker startup cancelled', 'AbortError');
  const make = async (delegate: 'GPU' | 'CPU'): Promise<HandTracker> => {
    const tracker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      ...config.mp,
    });
    if (signal?.aborted) { tracker.close(); throw new DOMException('Tracker startup cancelled', 'AbortError'); }
    return { detect: (video, t) => toHands(tracker.detectForVideo(video, t)), close: () => tracker.close() };
  };
  try {
    return { recognizer: await make('GPU'), delegate: 'GPU', backend: 'main' };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[gestures] GPU unavailable; using CPU', error);
    return { recognizer: await make('CPU'), delegate: 'CPU', backend: 'main' };
  }
}

async function createWorkerRecognizer(model: string, signal?: AbortSignal): Promise<TrackerResult> {
  const worker = new Worker(new URL('./tracker.worker.ts', import.meta.url));
  let closed = false;
  let capturing = false;
  let pending: { resolve: (hands: HandFrame[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  let inferenceMs = 0;
  let abortListener = () => {};
  const rejectPending = (error: Error) => {
    if (!pending) return;
    clearTimeout(pending.timer); pending.reject(error); pending = null;
  };
  const close = () => { closed = true; signal?.removeEventListener('abort', abortListener); worker.terminate(); rejectPending(new Error('Tracker closed')); };
  try {
    const delegate = await new Promise<'GPU' | 'CPU'>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker initialization timed out')), 30000);
      const fail = (error: Error) => { clearTimeout(timer); reject(error); };
      abortListener = () => { fail(new DOMException('Tracker startup cancelled', 'AbortError')); close(); };
      signal?.addEventListener('abort', abortListener, { once: true });
      if (signal?.aborted) { abortListener(); return; }
      worker.onerror = event => fail(new Error(event.message || 'Tracker worker failed'));
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { clearTimeout(timer); resolve(data.delegate); }
        else if (data.type === 'error') fail(new Error(data.error));
      };
      worker.postMessage({ type: 'init', base: location.origin, model: new URL(model, location.origin).href, settings: { ...config.mp } });
    });
    worker.onerror = event => { closed = true; worker.terminate(); rejectPending(new Error(event.message || 'Tracker worker failed')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') { rejectPending(new Error(data.error)); return; }
      if (data.type !== 'result' || !pending) return;
      inferenceMs = data.inferenceMs;
      const active = pending; pending = null; clearTimeout(active.timer); active.resolve(data.hands);
    };
    return { delegate, backend: 'worker', recognizer: {
      get inferenceMs() { return inferenceMs; },
      async detect(video, t) {
        if (closed || pending || capturing) throw new Error('Tracker unavailable or already processing a frame');
        capturing = true;
        let frame: ImageBitmap;
        try { frame = await createImageBitmap(video); }
        finally { capturing = false; }
        if (closed) { frame.close(); throw new Error('Tracker closed'); }
        return new Promise<HandFrame[]>((resolve, reject) => {
          const timer = setTimeout(() => { closed = true; worker.terminate(); rejectPending(new Error('Hand detection timed out')); }, 5000);
          pending = { resolve, reject, timer };
          try { worker.postMessage({ type: 'frame', frame, t }, [frame]); }
          catch (error) { frame.close(); rejectPending(error instanceof Error ? error : new Error(String(error))); }
        });
      }, close,
    } };
  } catch (error) { close(); throw error; }
}

export function toHands(result: HandLandmarkerResult): HandFrame[] {
  return result.landmarks.map((points, i) => ({
    landmarks: points.map(({ x, y, z }) => ({ x, y, z })),
    handedness: result.handedness[i]?.[0]?.categoryName,
  }));
}
