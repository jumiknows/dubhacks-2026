import { useEffect, useRef, useSyncExternalStore } from 'react';
import { config } from '../config';
import { gestures, type DebugInfo } from '../loop';
import type { Fixture } from '../replay';

const W = 320;
const H = 240;
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Landmarks, live metrics and the fixture recorder. Only mounted with ?gdebug=1. Draws to canvas, no React per frame. */
export function DebugOverlay() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useSyncExternalStore(gestures.subscribe, gestures.getStatus, gestures.getStatus);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    gestures.setDebugDrawer((d: DebugInfo) => draw(ctx, d));
    return () => gestures.setDebugDrawer(null);
  }, []);

  // R toggles fixture recording.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (document.activeElement instanceof HTMLInputElement) return;
      if (!gestures.getStatus().recording) {
        gestures.startRecording();
        return;
      }
      const frames = gestures.stopRecording();
      const name = window.prompt('Fixture name (e.g. pinch_tap_dim_light)', 'unnamed') || 'unnamed';
      const labels = (window.prompt('Expected events: select, drag_start, drop, reveal, dismiss, cancel, scroll_forward (hand up), scroll_backward (hand down), scroll (either); empty = no action', '') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const allowed = ['select', 'drag_start', 'drop', 'reveal', 'dismiss', 'cancel', 'scroll', 'scroll_forward', 'scroll_backward'];
      if (labels.some(label => !allowed.includes(label))) { window.alert('Unknown action label. Use the labels listed in the recording prompt.'); return; }
      const expected = labels.map(label => label.startsWith('scroll') ? 'scroll' : label);
      const scrollDirections = labels.filter(label => label.startsWith('scroll'));
      const scrollDirection = scrollDirections.length === 1 && scrollDirections[0] === 'scroll_forward' ? 'forward'
        : scrollDirections.length === 1 && scrollDirections[0] === 'scroll_backward' ? 'backward' : 'either';
      const fx: Fixture = {
        name,
        source: 'camera',
        recordingConfig: gestures.recordingConfig,
        recordedAt: new Date().toISOString().slice(0, 10),
        videoW: gestures.getStatus().videoWidth || config.camera.width,
        videoH: gestures.getStatus().videoHeight || config.camera.height,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        frames,
        hitTest: { default: expected.length ? 'p_test' : null },
        expected,
        expectedScroll: expected.includes('scroll') ? { direction: scrollDirection } : undefined,
      };
      const blob = new Blob([JSON.stringify(fx)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="g-debug">
      <canvas ref={canvas} width={W} height={H} />
      <div className="g-debug-row">
        <span>detect {status.fps} fps</span>
        <span>draw {status.renderFps} fps</span>
        <span>model {status.inferenceMs} ms / p95 {status.inferenceP95Ms} ms</span>
        <span>round trip {status.processingMs} ms</span>
        {status.inferenceMs > config.perf.slowInferenceMs && <span>model over {config.perf.slowInferenceMs} ms budget</span>}
        <span>detect {Math.round(status.detectionRate * 100)}%</span>
        <span>{status.delegate ?? 'not started'} / {status.backend ?? '-'}</span>
        <span>{status.videoWidth} × {status.videoHeight}</span>
        <span>hands {status.detectedHands} / {status.trackingState}</span>
        <span className={status.recording ? 'g-rec' : ''}>{status.recording ? 'REC (press R)' : 'R to record'}</span>
      </div>
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, d: DebugInfo) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.fillRect(0, 0, W, H);
  const mx = (x: number) => (config.mapping.mirror ? 1 - x : x) * W;

  // active box and idle line
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(config.mapping.boxLeft * W, config.mapping.boxTop * H, (config.mapping.boxRight - config.mapping.boxLeft) * W, (config.mapping.boxBottom - config.mapping.boxTop) * H);
  ctx.beginPath();
  ctx.moveTo(0, config.mapping.idleBelowY * H);
  ctx.lineTo(W, config.mapping.idleBelowY * H);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const h of d.frame.hands) {
    const primary = h === d.primary;
    ctx.strokeStyle = primary ? '#5eead4' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = primary ? 2 : 1;
    for (const [a, b] of BONES) {
      ctx.beginPath();
      ctx.moveTo(mx(h.landmarks[a].x), h.landmarks[a].y * H);
      ctx.lineTo(mx(h.landmarks[b].x), h.landmarks[b].y * H);
      ctx.stroke();
    }
    ctx.fillStyle = primary ? '#f472b6' : 'rgba(255,255,255,0.5)';
    for (const i of [4, 8, 12]) {
      ctx.beginPath();
      ctx.arc(mx(h.landmarks[i].x), h.landmarks[i].y * H, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // pinch ratio bar with on/off thresholds
  const f = d.features;
  const barX = 10, barY = H - 22, barW = W - 20, maxR = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(barX, barY, barW, 8);
  if (f) {
    ctx.fillStyle = f.pinchRatio < (d.out.state.pinched ? config.pinch.off : config.pinch.on) ? '#f472b6' : '#5eead4';
    ctx.fillRect(barX, barY, Math.min(1, f.pinchRatio / maxR) * barW, 8);
  }
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(barX + (config.pinch.on / maxR) * barW, barY - 3, 2, 14);
  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(barX + (config.pinch.off / maxR) * barW, barY - 3, 2, 14);

  ctx.fillStyle = '#e5e7eb';
  ctx.font = '11px ui-monospace, Menlo, monospace';
  const lines = [
    `mode ${d.out.state.mode}${d.out.swipe ? `  swipe ${Math.round(d.out.swipe.progress * 100)}%` : ''}`,
    f ? `2-finger ${f.pinchRatio.toFixed(2)}  3-finger ${f.threeFingerPinchRatio.toFixed(2)}` : 'no primary hand (see tracking status below)',
    f ? `middle extension ${f.middleExtension.toFixed(2)}  area ${f.bboxArea.toFixed(3)}` : '',
    `hands ${d.frame.hands.length}  hover ${d.out.state.hoverId ?? '-'}`,
  ];
  lines.forEach((l, i) => ctx.fillText(l, 10, 16 + i * 14));
  ctx.fillStyle = 'rgba(229,231,235,0.6)';
  ctx.fillText('pinch: on (yellow) off (blue)', 10, barY - 6);
}
