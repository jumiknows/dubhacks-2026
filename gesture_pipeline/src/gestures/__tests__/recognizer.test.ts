import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecognizer } from '../recognizer';
import { hand } from './synthetic';

const tasks = vi.hoisted(() => ({ resolve: vi.fn(), hand: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: tasks.resolve },
  HandLandmarker: { createFromOptions: tasks.hand },
}));

const result = {
  landmarks: [hand('point').map(([x, y, z]) => ({ x, y, z }))],
  worldLandmarks: [], handedness: [],
};
const tracker = { detectForVideo: vi.fn(() => result), close: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  tasks.resolve.mockResolvedValue({});
  tasks.hand.mockResolvedValue(tracker);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'application/octet-stream' }) }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hand tracker', () => {
  it('loads the same local model as the skeleton viewer and accepts hands without pose labels', async () => {
    const { recognizer, delegate } = await createRecognizer();
    expect(tasks.hand.mock.calls[0][1]).toMatchObject({
      baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5,
    });
    const hands = await recognizer.detect({} as HTMLVideoElement, 33);
    expect(delegate).toBe('GPU');
    expect(hands[0].landmarks).toHaveLength(21);
    expect(hands[0].landmarks).toEqual(result.landmarks[0]);
    recognizer.close();
    expect(tracker.close).toHaveBeenCalledOnce();
  });

  it('falls back to CPU when GPU initialization fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    tasks.hand.mockRejectedValueOnce(new Error('GPU unavailable'));
    expect((await createRecognizer()).delegate).toBe('CPU');
    expect(tasks.hand.mock.calls[1][1].baseOptions.delegate).toBe('CPU');
  });

  it('falls back to the hand-model URL when Vite returns HTML for a missing local asset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) }));
    await createRecognizer();
    expect(tasks.hand.mock.calls[0][1].baseOptions.modelAssetPath).toContain('/hand_landmarker/hand_landmarker/');
  });

});
