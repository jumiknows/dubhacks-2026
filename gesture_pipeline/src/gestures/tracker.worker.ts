// Type-only imports keep this a classic worker: MediaPipe's WASM loader uses importScripts.
import type * as Vision from '@mediapipe/tasks-vision';
import type { Config } from './config';
import type { HandFrame } from './types';

const scope = self as unknown as {
  exports: typeof Vision;
  importScripts: (...urls: string[]) => void;
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: unknown) => void;
};
let tracker: Vision.HandLandmarker | null = null;

scope.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      scope.exports = {} as typeof Vision;
      scope.importScripts(`${data.base}/mediapipe/vision_bundle.js`);
      const { FilesetResolver, HandLandmarker } = scope.exports;
      const vision = await FilesetResolver.forVisionTasks(`${data.base}/mediapipe/wasm`);
      const settings: Config['mp'] = data.settings;
      let delegate: 'GPU' | 'CPU' = 'GPU';
      const make = (backend: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: data.model, delegate: backend },
        canvas: new OffscreenCanvas(1, 1), runningMode: 'VIDEO', ...settings,
      });
      // Compile the first inference while the UI still says Starting; never time it out as a live frame.
      const warm = (model: Vision.HandLandmarker) => {
        const canvas = new OffscreenCanvas(16, 16);
        canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
        model.detectForVideo(canvas, 0);
      };
      try { tracker = await make('GPU'); warm(tracker); }
      catch { tracker?.close(); delegate = 'CPU'; tracker = await make('CPU'); warm(tracker); }
      scope.postMessage({ type: 'ready', delegate });
    } catch (error) {
      scope.postMessage({ type: 'error', error: String(error) });
    }
    return;
  }
  if (data.type === 'frame') {
    const frame = data.frame as ImageBitmap;
    try {
      if (!tracker) throw new Error('Tracker is not ready');
      const start = performance.now();
      const result = tracker.detectForVideo(frame, data.t);
      const inferenceMs = performance.now() - start;
      const hands: HandFrame[] = result.landmarks.map((points, index) => ({
        landmarks: points.map(({ x, y, z }) => ({ x, y, z })),
        handedness: result.handedness[index]?.[0]?.categoryName,
          handednessScore: result.handedness[index]?.[0]?.score,
      }));
      scope.postMessage({ type: 'result', hands, inferenceMs });
    } catch (error) {
      scope.postMessage({ type: 'error', error: String(error) });
    } finally { frame.close(); }
  }
};
