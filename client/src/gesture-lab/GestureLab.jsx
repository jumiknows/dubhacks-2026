import { useEffect, useRef, useState } from 'react';
import { config, gestures, setPath, useGestureEvents, useGestureStatus } from 'conjure-gestures';
import { criteria, products } from './data';
import { features } from './assessment';
import { useAssessment } from './useAssessment';
import { AssessmentPanel } from './AssessmentPanel';
import { FeatureScene } from './FeatureScene';
import { replayFeature } from './featureReplay';
import './lab.css';

const afterRender = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
export default function GestureLab() {
  const status = useGestureStatus();
  const [feature, setFeature] = useState('expand');
  const [hand, setHand] = useState('right');
  const [ids, setIds] = useState(['alpine', 'camp']);
  const [expanded, setExpanded] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [priority, setPriority] = useState('weight');
  const [transaction, setTransaction] = useState(null);
  const [clicks, setClicks] = useState(0);
  const [drops, setDrops] = useState({});
  const [cancelled, setCancelled] = useState({});
  const [selected, setSelected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [log, setLog] = useState([]);
  const [replaying, setReplaying] = useState(false);
  const [runProgress, setRunProgress] = useState('');
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(12);
  const [swapped, setSwapped] = useState(config.hands.swapHandedness);
  const replayAbort = useRef(null);
  const workspace = useRef(null);
  const dragOrigins = useRef({});
  const scrollBaseline = useRef(0);
  const pageBaseline = useRef(0);
  const state = useRef({});
  state.current = { feature, ids, expanded, comparison };
  const assessment = useAssessment(workspace);
  const assessmentRef = useRef(assessment); assessmentRef.current = assessment;
  useEffect(() => () => { replayAbort.current?.abort(); gestures.stop(); }, []);
  const target = id => workspace.current?.querySelector(`[data-gesture-id="${id}"]`);
  const verify = e => {
    const root = workspace.current;
    if (!root) return false;
    if (e.type === 'expand' || e.type === 'collapse') return root.querySelector(`[data-gesture-object="${e.group_id}"]`)?.dataset.gestureKind === (e.type === 'expand' ? 'group' : 'original');
    if (e.type === 'compare') return !!document.querySelector('[data-testid="comparison"]');
    if (e.type === 'select' || e.type === 'release') return Number(root.querySelector('[data-click-count]')?.dataset.clickCount) === 1;
    if (e.type === 'drop') return target(e.target_id)?.dataset.dropped === 'true';
    if (e.type === 'cancel') return target(e.target_id)?.dataset.cancelled === 'true';
    if (e.type === 'reveal') return !!root.querySelector('[data-testid="navigation-primary"]');
    if (e.type === 'dismiss') return !root.querySelector('[data-testid="navigation-primary"]');
    if (e.type === 'scroll') {
      const scroll = root.querySelector('[data-gesture-scroll]');
      return !!scroll && Math.sign(scroll.scrollTop - scrollBaseline.current) === Math.sign(e.delta_y)
        && Math.abs(scroll.scrollTop - scrollBaseline.current) > 10 && window.scrollY === pageBaseline.current;
    }
    return false;
  };
  useGestureEvents('*', e => {
    if (e.type === 'bimanual_start' || e.type === 'bimanual_progress') setTransaction(e);
    if (e.type === 'bimanual_end' || e.type === 'bimanual_cancel') setTransaction(null);
    if (e.type === 'expand' && products.some(p => p.id === e.group_id)) setExpanded(values => [...new Set([...values, e.group_id])]);
    if (e.type === 'collapse') setExpanded(values => values.filter(id => id !== e.group_id));
    if (e.type === 'compare' && e.target_ids?.length === 2 && e.target_ids[0] !== e.target_ids[1]
      && e.target_ids.every(id => products.some(p => p.id === id) && !state.current.expanded.includes(id))) setComparison(e.target_ids);
    if (e.type === 'select' && e.target_id === 'lab-click') setClicks(n => n + 1);
    if (e.type === 'reveal' && state.current.feature === 'reveal') { setIds(['alpine']); setSelected(true); }
    if (e.type === 'dismiss' && e.target_id === 'lab-card' && state.current.feature === 'dismiss') setIds([]);
    if (e.type === 'drag_start') {
      const element = target(e.target_id);
      const matrix = element ? new DOMMatrix(getComputedStyle(element).transform) : new DOMMatrix();
      dragOrigins.current[e.target_id] = { x: e.start_x, y: e.start_y, dx: matrix.m41, dy: matrix.m42 };
    }
    if (e.type === 'drag_move') {
      const origin = dragOrigins.current[e.target_id], element = target(e.target_id);
      if (origin && element) element.style.transform = `translate(${origin.dx + (e.x - origin.x) * innerWidth}px, ${origin.dy + (e.y - origin.y) * innerHeight}px)`;
    }
    if (e.type === 'drop') { setDrops(values => ({ ...values, [e.target_id]: e.drop_target_id === 'lab-tray' })); delete dragOrigins.current[e.target_id]; }
    if (e.type === 'cancel') {
      for (const id of e.target_id ? [e.target_id] : Object.keys(dragOrigins.current)) {
        const element = target(id); if (element) element.style.transform = '';
        setCancelled(values => ({ ...values, [id]: true })); delete dragOrigins.current[id];
      }
    }
    assessmentRef.current.observeEvent(e, () => verify(e));
    if (!['hover', 'drag_move', 'bimanual_progress'].includes(e.type)) setLog(rows => [e, ...rows].slice(0, 16));
  });
  const stop = (reason = 'camera stopped') => {
    assessment.finish(reason); replayAbort.current?.abort(); replayAbort.current = null;
    gestures.stop(); setReplaying(false); setRunProgress('');
  };
  const loadScene = async (next = feature) => {
    assessment.finish('scene reset'); gestures.cancelInteraction();
    setFeature(next); setIds(['reveal', 'idle'].includes(next) ? [] : ['alpine', 'camp']);
    setExpanded(next === 'collapse' ? ['alpine'] : []); setComparison(null); setTransaction(null);
    setClicks(0); setDrops({}); setCancelled({}); setSelected(false); setError('');
    dragOrigins.current = {}; setRevision(n => n + 1);
    await afterRender();
    workspace.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    scrollBaseline.current = workspace.current?.querySelector('[data-gesture-scroll]')?.scrollTop ?? 0;
    pageBaseline.current = window.scrollY;
  };
  const reset = async () => { stop('reset'); setLog([]); await loadScene(); };
  const spawn = id => {
    assessment.finish('objects spawned'); gestures.cancelInteraction();
    if (!['expand', 'collapse', 'compare'].includes(feature)) setFeature('expand');
    setIds(values => [...new Set([...values, id])]); setExpanded(values => values.filter(x => x !== id)); setError('');
    workspace.current?.scrollIntoView({ block: 'nearest' });
  };
  const beginLive = async () => {
    if (status.camera !== 'on') { setError('Start the camera before beginning a live trial.'); return; }
    await loadScene(); assessment.begin(feature, hand, 'hand', duration * 1000);
  };
  const run = async selectedFeatures => {
    stop('replay started');
    const abort = new AbortController(); replayAbort.current = abort;
    setReplaying(true); setError('');
    try {
      for (const [i, id] of selectedFeatures.entries()) {
        if (abort.signal.aborted) break;
        setRunProgress(`${i + 1}/${selectedFeatures.length} · ${features.find(f => f.id === id).label}`);
        await loadScene(id);
        if (abort.signal.aborted) break;
        assessment.begin(id, hand, 'replay', 0);
        await replayFeature(id, workspace.current, abort.signal, hand);
        await afterRender(); assessment.finish(); gestures.stop();
      }
    } catch (e) {
      if (replayAbort.current === abort) {
        assessment.finish(e.name === 'AbortError' ? 'replay cancelled' : 'replay error');
        if (e.name !== 'AbortError') setError(e.message);
      }
    } finally {
      if (replayAbort.current === abort) { replayAbort.current = null; setReplaying(false); setRunProgress(''); gestures.stop(); }
    }
  };
  const spec = features.find(f => f.id === feature);
  const cameraOn = status.camera === 'on';
  const busy = replaying || !!assessment.active;
  const compared = comparison?.map(id => products.find(p => p.id === id));
  const preferred = compared && [...compared].sort((a, b) => a[priority] - b[priority])[0];
  return <main className="gesture-lab">
    <header className="lab-header"><div><a href="/" className="lab-back">← Back to app</a><p className="lab-eyebrow">GESTURE TEST ENVIRONMENT</p><h1>Objects with more beneath.</h1></div><span className="lab-tag">Local demo · fictional products</span></header>
    <section className="lab-toolbar" data-gesture-ignore aria-label="Lab controls">
      <button onClick={() => { stop(); setPath('mp.numHands', 2); void status.start(); }} disabled={busy || cameraOn || status.camera === 'starting'}>Start camera</button>
      <button onClick={() => stop()} disabled={!cameraOn && !replaying && status.camera !== 'starting' && !assessment.active}>Stop</button>
      <button onClick={reset}>Reset objects</button>
      <label><input type="checkbox" checked={swapped} disabled={busy} onChange={e => { stop('labels changed'); setPath('hands.swapHandedness', e.target.checked); setSwapped(e.target.checked); }} /> Swap left/right labels</label>
      <span className="lab-local">{replaying ? `SYNTHETIC · ${runProgress}` : cameraOn ? `LIVE · ${status.fps} detection fps` : status.camera === 'starting' ? 'Loading camera and model…' : 'Camera off · test objects are ready'}</span>
    </section>
    <section className="lab-task-controls" data-gesture-ignore aria-label="Test task">
      <label>Test feature <select aria-label="Test feature" value={feature} disabled={busy} onChange={e => loadScene(e.target.value)}>{features.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      <label>Hand <select aria-label="Trial hand" value={hand} disabled={busy || spec.pair} onChange={e => setHand(e.target.value)}><option value="right">Right</option><option value="left">Left</option></select></label>
      <button onClick={() => loadScene()} disabled={busy}>Load test scene</button>
      <button onClick={() => spawn('alpine')} disabled={busy}>Spawn primary object</button>
      <button onClick={() => spawn('camp')} disabled={busy}>Spawn comparison object</button>
      <button onClick={() => { assessment.finish('scene cleared'); gestures.cancelInteraction(); setIds([]); }} disabled={busy || !['expand', 'collapse', 'compare'].includes(feature)}>Clear objects</button>
    </section>
    <div className="lab-instruction"><b>{spec.label}</b><span>{spec.instruction} Start open; release between actions.</span></div>
    <div className="lab-hand-status" aria-live="polite">{['left', 'right'].map(id => <span key={id} data-hand={id}><b>{id === 'left' ? 'L' : 'R'}</b> {id} · {status.hands?.[id]?.present ? status.hands[id].identified ? status.hands[id].pinched ? 'pinched' : 'tracked' : 'identity uncertain' : 'waiting'}</span>)}<span data-trial-frames={assessment.recorder.current?.frames.length ?? 0}>{assessment.active ? `${assessment.active.source === 'hand' ? 'Live trial' : 'Replay trial'} · ${(assessment.elapsed / 1000).toFixed(1)} s · ${assessment.recorder.current?.frames.length ?? 0} frames` : 'No scored trial running'}</span></div>
    <div className="lab-feedback" role="status">{error || status.error ? <span className="lab-error">{error || status.error}</span> : transaction ? <><span>{transaction.gesture} · {Math.round((transaction.progress ?? 0) * 100)}%</span><progress max="1" value={transaction.progress ?? 0} /></> : <span>Primary targets load without the camera or backend. Use the selected scene, then begin a live trial or replay.</span>}</div>
    <section className="lab-scene-container" ref={workspace} aria-label="Feature test scene"><FeatureScene key={revision} feature={feature} ids={ids} expanded={expanded} clicks={clicks} drops={drops} cancelled={cancelled} selected={selected} setClicks={setClicks} /></section>
    <section className="lab-trial-controls" data-gesture-ignore aria-label="Trial controls">
      <label>Trial seconds <input aria-label="Trial seconds" type="number" min="5" max="60" value={duration} disabled={busy} onChange={e => setDuration(Math.max(5, Math.min(60, Number(e.target.value) || 12)))} /></label>
      <button onClick={beginLive} disabled={!cameraOn || busy}>Begin live trial</button>
      <button onClick={() => { assessment.finish(); gestures.cancelInteraction(); }} disabled={!assessment.active || replaying}>Finish trial</button>
      <button onClick={() => run([feature])} disabled={busy || cameraOn || status.camera === 'starting'}>Replay selected feature</button>
      <button onClick={() => run(features.map(f => f.id))} disabled={busy || cameraOn || status.camera === 'starting'}>Run all feature replays</button>
      <div className="lab-quick-replays">{['expand', 'collapse', 'compare'].map(id => <button key={id} onClick={() => run([id])} disabled={busy || cameraOn || status.camera === 'starting'}>Replay {id}</button>)}</div>
    </section>
    {compared && <section className="lab-comparison" aria-label="Product comparison" data-testid="comparison"><div className="lab-comparison-title"><div><p className="lab-eyebrow">SIDE BY SIDE</p><h2>A choice shaped by your priorities.</h2></div><button onClick={() => setComparison(null)} data-gesture-ignore>Close comparison</button></div>
      <label data-gesture-ignore>Most important to you <select value={priority} onChange={e => setPriority(e.target.value)}><option value="weight">Lower carrying weight</option><option value="price">Lower price</option><option value="comfort">Colder comfort temperature</option><option value="volume">Smaller packed volume</option></select></label>
      <table><caption>Fictional sleeping bag specifications. Highlighted values are lower.</caption><thead><tr><th>Attribute</th>{compared.map(p => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{criteria.map(c => <tr key={c.key}><th>{c.label}</th>{compared.map(p => <td key={p.id} data-better={p[c.key] === Math.min(...compared.map(o => o[c.key]))}>{c.format(p[c.key])}</td>)}</tr>)}<tr><th>Insulation</th>{compared.map(p => <td key={p.id}>{p.insulation}</td>)}</tr></tbody></table><p className="lab-verdict"><strong>{preferred.name}</strong> leads on your selected priority. Alpine is lighter, packs smaller and has a colder demo comfort rating; Camp costs $140 less.</p></section>}
    <AssessmentPanel assessment={assessment} status={status} />
    <details className="lab-log"><summary>Recognition trace · {log.length} recent events</summary><p>All sources are labeled. Mouse and keyboard actions are excluded from camera accuracy.</p><ol>{log.length ? log.map(e => <li key={e.event_id}><code>{e.type}</code><span>{e.target_ids?.join(' + ') ?? e.target_id}</span><small>{e.source} · {e.hand_id ?? e.interaction_id}</small></li>) : <li>No events yet.</li>}</ol></details>
  </main>;
}
