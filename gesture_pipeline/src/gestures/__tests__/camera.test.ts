import { afterEach, expect, it, vi } from 'vitest';
import { startCamera } from '../camera';

afterEach(() => vi.unstubAllGlobals());
it('a late cancelled camera permission cannot replace or stop a newly started stream', async () => {
  let resolve!: (stream: MediaStream) => void;
  const oldStop = vi.fn(), newStop = vi.fn();
  const oldStream = { getTracks: () => [{ stop: oldStop }] } as unknown as MediaStream;
  const newStream = { getTracks: () => [{ stop: newStop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(newStream);
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
  const abort = new AbortController();
  const oldStart = startCamera(video, abort.signal); abort.abort();
  expect(await startCamera(video)).toBe('on');
  resolve(oldStream); expect(await oldStart).toBe('off');
  expect(video.srcObject).toBe(newStream);
  expect(oldStop).toHaveBeenCalledOnce(); expect(newStop).not.toHaveBeenCalled();
});
