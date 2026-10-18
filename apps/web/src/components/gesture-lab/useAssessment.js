import { useEffect, useRef, useState } from 'react';
import { config, gestures } from 'conjure-gestures';
import { TrialRecorder, trialSpec } from './assessment';

export function useAssessment(workspace, onSample) {
  const recorder = useRef(new TrialRecorder()).current;
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [latest, setLatest] = useState(null);
  const sampleHandler = useRef(onSample); sampleHandler.current = onSample;
  const [notes, setNotes] = useState('');
  const [smoothness, setSmoothness] = useState('');
  const controls = useRef({ notes, smoothness }); controls.current = { notes, smoothness };
  const finish = (reason = 'finished') => {
    const c = controls.current;
    const result = recorder.finish(performance.now(), { reason, notes: c.notes, smoothness: c.smoothness ? Number(c.smoothness) : null });
    if (result) setResults([...recorder.results]);
    setActive(null);
    return result;
  };
  useEffect(() => gestures.subscribeFrames(sample => {
    sampleHandler.current?.(sample);
    const node = workspace.current?.querySelector('[data-point-target]');
    const r = node?.getBoundingClientRect();
    recorder.observeFrame(sample, r ? { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight,
      width: innerWidth, height: innerHeight, radius: r.width / 2 } : null);
    // Keep React updates out of the per-result path.
    recorder.latestSample = sample;
  }), [recorder, workspace]);
  useEffect(() => {
    const tick = setInterval(() => {
      setLatest(recorder.latestSample ?? null);
      if (recorder.current) {
        const ms = performance.now() - recorder.current.startedAt;
        setElapsed(ms);
        if (recorder.current.source === 'hand' && ms >= recorder.current.context.durationMs) finish();
      }
    }, 250);
    const hidden = () => { if (document.hidden && recorder.current) finish('page hidden'); };
    document.addEventListener('visibilitychange', hidden);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', hidden); };
  }, [recorder]);
  const begin = (feature, hand, source, durationMs) => {
    finish('replaced');
    setSmoothness(''); controls.current.smoothness = '';
    const trial = recorder.begin(trialSpec(feature, hand), source, performance.now(), {
      durationMs, settings: JSON.parse(JSON.stringify(config)), viewport: { width: innerWidth, height: innerHeight },
      camera: gestures.getStatus(), notes: controls.current.notes,
    });
    setActive({ id: trial.id, feature, source, durationMs }); setElapsed(0);
  };
  const rateSmoothness = value => {
    setSmoothness(value);
    const last = recorder.results.at(-1);
    if (!recorder.current && last) { last.smoothness = value ? Number(value) : null; setResults([...recorder.results]); }
  };
  const observeEvent = (event, verify) => {
    if (recorder.observeEvent(event) >= 0) {
      let attempts = 0;
      const check = now => {
        const applied = verify();
        if (applied || ++attempts >= 4) recorder.markPaint(event.event_id, now, applied);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }
  };
  const download = () => {
    const report = recorder.export({ userAgent: navigator.userAgent, notes, smoothness: smoothness || null,
      settings: JSON.parse(JSON.stringify(config)), url: location.href });
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `gesture-assessment-${Date.now()}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return { recorder, results, active, elapsed, latest, begin, finish, observeEvent, download,
    notes, setNotes, smoothness, setSmoothness: rateSmoothness };
}
