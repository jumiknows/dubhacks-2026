import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureController } from '../loop';
import { gestureBus } from '../bus';

const mocks = vi.hoisted(() => ({ camera: vi.fn(), stop: vi.fn(), tracker: vi.fn() }));
vi.mock('../camera', () => ({ startCamera: mocks.camera, stopCamera: mocks.stop }));
vi.mock('../recognizer', () => ({ createRecognizer: mocks.tracker }));

let controller: GestureController;
const close = vi.fn();
let video: HTMLVideoElement;
beforeEach(() => {
  vi.clearAllMocks();
  controller = new GestureController();
  video = { videoWidth: 640, videoHeight: 480, requestVideoFrameCallback: vi.fn(() => 42), cancelVideoFrameCallback: vi.fn() } as unknown as HTMLVideoElement;
  controller.attachVideo(video);
  mocks.camera.mockResolvedValue('on');
  mocks.tracker.mockResolvedValue({ recognizer: { detect: vi.fn(), close }, delegate: 'GPU' });
});
afterEach(() => controller.dispose());

describe('camera/controller lifecycle', () => {
  it('can restart while an old permission request is still pending', async () => {
    let resolve!: (value: string) => void;
    mocks.camera.mockReturnValueOnce(new Promise<string>(done => { resolve = done; }));
    const oldStart = controller.start(); controller.stop();
    await controller.start();
    expect(controller.getStatus().camera).toBe('on');
    resolve('on'); await oldStart;
    expect(controller.getStatus().camera).toBe('on');
    expect(mocks.tracker).toHaveBeenCalledOnce();
  });
  it('keeps only one inference in flight and ignores a result arriving after Stop', async () => {
    let resolve!: (value: never[]) => void;
    const detect = vi.fn(() => new Promise<never[]>(done => { resolve = done; }));
    mocks.tracker.mockResolvedValueOnce({ recognizer: { detect, close }, delegate: 'GPU', backend: 'worker' });
    Object.assign(video, { readyState: 2, currentTime: 1 });
    await controller.start();
    const callback = vi.mocked(video.requestVideoFrameCallback).mock.calls[0][0];
    callback(1, {} as VideoFrameCallbackMetadata);
    Object.assign(video, { currentTime: 2 }); callback(2, {} as VideoFrameCallbackMetadata);
    expect(detect).toHaveBeenCalledOnce();
    controller.stop();
    const emit = vi.spyOn(gestureBus, 'emit');
    resolve([]); await new Promise(done => setTimeout(done, 0));
    expect(emit).not.toHaveBeenCalled();
    expect(controller.getStatus().camera).toBe('off');
    emit.mockRestore();
  });
  it('does not resurrect tracking when permission resolves after Stop', async () => {
    let resolve!: (value: string) => void;
    mocks.camera.mockReturnValueOnce(new Promise<string>(done => { resolve = done; }));
    const start = controller.start();
    controller.stop(); resolve('on'); await start;
    expect(controller.getStatus().camera).toBe('off');
    expect(mocks.tracker).not.toHaveBeenCalled();
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
  });
  it('closes a model that finishes loading after Stop', async () => {
    let resolve!: (value: unknown) => void;
    mocks.tracker.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const start = controller.start();
    await vi.waitFor(() => expect(mocks.tracker).toHaveBeenCalled());
    controller.stop(); resolve({ recognizer: { close }, delegate: 'GPU' }); await start;
    expect(close).toHaveBeenCalledOnce();
    expect(controller.getStatus().camera).toBe('off');
  });
  it('prevents concurrent starts and cancels the scheduled callback on Stop', async () => {
    await Promise.all([controller.start(), controller.start()]);
    expect(mocks.camera).toHaveBeenCalledOnce();
    expect(video.requestVideoFrameCallback).toHaveBeenCalledOnce();
    controller.stop();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
    expect(controller.getStatus().camera).toBe('off');
  });
  it('stops the camera on model failure rather than leaving it active', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.tracker.mockRejectedValueOnce(new Error('model failed'));
    await controller.start();
    expect(mocks.stop).toHaveBeenCalledWith(video);
    expect(controller.getStatus().camera).toBe('error');
    error.mockRestore();
  });
});
