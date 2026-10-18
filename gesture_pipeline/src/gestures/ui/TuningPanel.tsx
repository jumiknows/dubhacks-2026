import { useEffect, useState } from 'react';
import { getPath, onConfigChange, overrides, resetConfig, setPath } from '../config';
import { gestures } from '../loop';

type Knob = { path: string; label: string; min: number; max: number; step: number };

const GROUPS: { title: string; knobs: Knob[] }[] = [
  {
    title: 'Camera (stop and start to apply)',
    knobs: [
      { path: 'camera.width', label: 'requested width', min: 320, max: 1280, step: 160 },
      { path: 'camera.height', label: 'requested height', min: 240, max: 960, step: 120 },
      { path: 'camera.fps', label: 'requested camera fps', min: 15, max: 60, step: 15 },
    ],
  },
  {
    title: 'Tracking (stop and start camera to apply)',
    knobs: [
      { path: 'mp.minHandDetectionConfidence', label: 'hand detection confidence', min: 0.2, max: 0.9, step: 0.05 },
      { path: 'mp.minHandPresenceConfidence', label: 'hand presence confidence', min: 0.2, max: 0.9, step: 0.05 },
      { path: 'mp.minTrackingConfidence', label: 'tracking confidence', min: 0.2, max: 0.9, step: 0.05 },
      { path: 'mp.numHands', label: 'maximum hands', min: 1, max: 2, step: 1 },
    ],
  },
  {
    title: 'Smoothing',
    knobs: [
      { path: 'smoothing.minCutoff', label: 'minCutoff (jitter at rest)', min: 0.05, max: 5, step: 0.05 },
      { path: 'smoothing.beta', label: 'beta (lag at speed)', min: 0, max: 0.1, step: 0.001 },
      { path: 'presentation.responseMs', label: 'display following time ms', min: 0, max: 50, step: 1 },
    ],
  },
  {
    title: 'Pinch',
    knobs: [
      { path: 'pinch.on', label: 'on (closes below)', min: 0.05, max: 0.6, step: 0.01 },
      { path: 'pinch.off', label: 'off (opens above)', min: 0.1, max: 0.8, step: 0.01 },
      { path: 'pinch.confirmMs', label: 'closed pinch confirmation ms', min: 0, max: 120, step: 5 },
      { path: 'pinch.releaseMs', label: 'release debounce ms', min: 0, max: 200, step: 10 },
    ],
  },
  {
    title: 'Pinch dragging',
    knobs: [
      { path: 'drag.minDist', label: 'minimum palm travel', min: 0.01, max: 0.1, step: 0.005 },
      { path: 'drag.armMs', label: 'press stabilization ms', min: 0, max: 300, step: 10 },
    ],
  },
  {
    title: 'Three-finger swipe',
    knobs: [
      { path: 'swipe.on', label: 'three-finger pinch closes below', min: 0.1, max: 0.6, step: 0.01 },
      { path: 'swipe.off', label: 'three-finger pinch opens above', min: 0.2, max: 0.8, step: 0.01 },
      { path: 'swipe.minDist', label: 'minimum hand travel (frame widths)', min: 0.03, max: 0.4, step: 0.01 },
      { path: 'swipe.dominance', label: 'direction dominance (either axis)', min: 1, max: 5, step: 0.1 },
      { path: 'swipe.maxMiddleExtension', label: 'middle finger bend allowance', min: 0.8, max: 1.4, step: 0.025 },
      { path: 'swipe.armMs', label: 'arm debounce ms', min: 0, max: 200, step: 10 },
      { path: 'swipe.releaseMs', label: 'pose dropout grace ms', min: 50, max: 300, step: 10 },
    ],
  },
  {
    title: 'Three-finger scrolling',
    knobs: [
      { path: 'scroll.gain', label: 'scroll distance per hand movement', min: 0.5, max: 5, step: 0.1 },
      { path: 'scroll.deadband', label: 'ignore small vertical jitter', min: 0, max: 0.02, step: 0.001 },
    ],
  },
  {
    title: 'Hands and mapping',
    knobs: [
      { path: 'hands.minArea', label: 'min hand area', min: 0.001, max: 0.1, step: 0.001 },
      { path: 'hands.handLostMs', label: 'hand lost ms', min: 50, max: 1000, step: 25 },
      { path: 'mapping.boxLeft', label: 'box left', min: 0, max: 0.45, step: 0.01 },
      { path: 'mapping.boxRight', label: 'box right', min: 0.55, max: 1, step: 0.01 },
      { path: 'mapping.boxTop', label: 'box top', min: 0, max: 0.45, step: 0.01 },
      { path: 'mapping.boxBottom', label: 'box bottom', min: 0.55, max: 1, step: 0.01 },
      { path: 'mapping.idleBelowY', label: 'idle below y', min: 0.5, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Timing',
    knobs: [
      { path: 'cooldownMs', label: 'cooldown ms', min: 0, max: 1500, step: 25 },
      { path: 'hover.stickyMs', label: 'hover sticky ms', min: 0, max: 500, step: 10 },
    ],
  },
];

/** Live sliders bound to the config. Changes apply instantly and persist in localStorage. */
export function TuningPanel() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const off = onConfigChange(() => force(n => n + 1));
    return () => {
      off();
    };
  }, []);

  const copy = async () => {
    const text = JSON.stringify(overrides(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      console.log(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside className="g-tuning" data-open={open}>
      <header>
        <button onClick={() => setOpen(o => !o)} data-gesture-ignore>
          {open ? 'Hide tuning' : 'Tuning'}
        </button>
        {open && (
          <>
            <button onClick={copy} data-gesture-ignore>{copied ? 'Copied' : 'Copy changed values'}</button>
            <button onClick={() => { gestures.stop(); resetConfig(); }} data-gesture-ignore>Reset</button>
          </>
        )}
      </header>
      {open &&
        GROUPS.map(g => (
          <section key={g.title}>
            <h4>{g.title}</h4>
            {g.knobs.map(k => {
              const v = Number(getPath(k.path));
              return (
                <label key={k.path}>
                  <span>{k.label}</span>
                  <input
                    id={`knob-${k.path}`}
                    type="range"
                    min={k.min}
                    max={k.max}
                    step={k.step}
                    value={v}
                    onChange={e => setPath(k.path, Number(e.target.value))}
                  />
                  <output>{v}</output>
                </label>
              );
            })}
          </section>
        ))}
    </aside>
  );
}
