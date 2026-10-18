import { useSyncExternalStore } from 'react';
import { getPoseView, subscribePose, type NamedGesture } from '../pose';
import { gestures } from '../loop';

const LABEL: Record<NamedGesture, string> = {
  'swipe-up': 'Swipe up',
  'swipe-down': 'Swipe down',
  'swipe-left': 'Swipe left',
  'swipe-right': 'Swipe right',
  grab: 'Grab',
  release: 'Release',
};

/** Small live readout of the latest swipe or fist. Ignores hand hits so it never steals a click. */
export function GestureDebug() {
  const pose = useSyncExternalStore(subscribePose, getPoseView, getPoseView);
  const status = useSyncExternalStore(gestures.subscribe, gestures.getStatus, gestures.getStatus);
  return (
    <aside className="g-pose" data-gesture-ignore aria-label="Gesture debug">
      <style>{`
        .g-pose {
          position: fixed;
          top: 12px;
          left: 12px;
          z-index: 50;
          width: 220px;
          margin: 0;
          padding: 8px 10px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 12px;
          background: rgba(8, 12, 18, 0.88);
          color: #e8eef6;
          font: 12px/1.35 ui-monospace, Menlo, monospace;
          pointer-events: auto;
        }
        .g-pose strong { display: block; letter-spacing: 0.08em; font-size: 10px; color: #8ef0dc; }
        .g-pose p { margin: 4px 0 0; }
        .g-pose-hint { margin-top: 6px; color: #f6d98a; font-weight: 700; }
        .g-pose-last { margin: 6px 0 0; font-size: 14px; font-weight: 700; }
        .g-pose ol { list-style: none; margin: 6px 0 0; padding: 0; color: #9aa8b5; }
      `}</style>
      <strong>GESTURES</strong>
      <p>{(['left', 'right'] as const).map(id => `${id}: ${status.hands?.[id].present ? status.hands[id].pinched ? 'pinched' : 'open' : 'absent'}`).join(' / ')}</p>
      <p>Right hand pose</p>
      <p>Fist {pose.fist} · curl {pose.curl.toFixed(2)}</p>
      <p>
        {pose.angle == null ? 'Angle —' : `Angle ${Math.round(pose.angle * 180 / Math.PI)}°`}
        {' · '}
        arc {Math.round(pose.arc * 180 / Math.PI)}°
        {pose.source ? ` · ${pose.source}` : ''}
      </p>
      {pose.hint ? <p className="g-pose-hint">{pose.hint}</p> : null}
      <p className="g-pose-last">{pose.last ? LABEL[pose.last] : 'Waiting'}</p>
      <ol>
        {pose.history.map((item, index) => (
          <li key={`${item.t}-${index}`}>{LABEL[item.name]}</li>
        ))}
      </ol>
    </aside>
  );
}
