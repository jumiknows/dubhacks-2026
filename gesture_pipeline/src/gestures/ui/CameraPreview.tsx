import { useEffect, useRef } from 'react';
import { gestures } from '../loop';
import { useSyncExternalStore } from 'react';

/** Small mirrored camera preview with the on-device badge. Also the video element the pipeline reads from. */
export function CameraPreview() {
  const ref = useRef<HTMLVideoElement>(null);
  const status = useSyncExternalStore(gestures.subscribe, gestures.getStatus, gestures.getStatus);
  const messages = {
    no_hand: 'Looking for your hand',
    too_small: 'Hand found. Move closer',
    switching: 'Hand found. Reacquiring',
    resting: 'Hand found. Raise it a little',
    tracking: 'Hand tracked',
  };

  useEffect(() => {
    gestures.attachVideo(ref.current);
    return () => gestures.attachVideo(null);
  }, []);

  return (
    <div className="g-preview" data-on={status.camera === 'on'} aria-label="Camera preview">
      <video ref={ref} muted playsInline />
      {status.camera === 'on' && <span className="g-badge">{messages[status.trackingState]}</span>}
      {status.camera === 'on' && status.lighting === 'low' && <span className="g-warn">Move into the light</span>}
    </div>
  );
}
