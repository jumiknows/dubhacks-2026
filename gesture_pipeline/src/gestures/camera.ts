// Webcam access. Frames stay in the browser.

import { config } from './config';
import type { CameraStatus } from './types';

export async function startCamera(video: HTMLVideoElement, signal?: AbortSignal): Promise<CameraStatus> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'error'; // needs HTTPS or localhost
  let acquiredStream: MediaStream | null = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: config.camera.width },
        height: { ideal: config.camera.height },
        frameRate: { ideal: config.camera.fps, max: config.camera.fps },
        facingMode: 'user',
      },
    });
    acquiredStream = stream;
    if (signal?.aborted) { stream.getTracks().forEach(track => track.stop()); return 'off'; }
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    if (signal?.aborted) {
      stream.getTracks().forEach(track => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
      return 'off';
    }
    return 'on';
  } catch (e) {
    acquiredStream?.getTracks().forEach(track => track.stop());
    if (acquiredStream && video.srcObject === acquiredStream) video.srcObject = null;
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
    if (name === 'NotReadableError' || name === 'AbortError') return 'busy'; // another app holds the camera
    return 'error';
  }
}

export function stopCamera(video: HTMLVideoElement) {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach(tr => tr.stop());
  video.srcObject = null;
}
