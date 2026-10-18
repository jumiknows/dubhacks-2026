import { features } from './assessment';

const ms = n => n == null ? '—' : `${Math.round(n)} ms`;
export function AssessmentPanel({ assessment: a, status }) {
  const last = a.results.at(-1);
  const cameraResults = a.results.filter(r => r.source === 'hand' && r.outcome !== 'incomplete');
  const passes = cameraResults.filter(r => r.outcome === 'pass').length;
  return <section className="lab-assessment" aria-label="Feature assessment" data-gesture-ignore>
    <div className="lab-assessment-heading"><div><h2>Measure every feature</h2><p>{cameraResults.length ? `${passes}/${cameraResults.length} live trials passed` : 'Live accuracy: not measured yet'} · Synthetic checks are listed separately.</p></div><button onClick={a.download} disabled={!a.results.length || !!a.active}>Export session JSON</button></div>
    <div className="lab-metrics">
      <span><b>{status.camera === 'on' ? status.fps : '—'}</b>camera results/s</span>
      <span><b>{status.camera === 'on' ? status.renderFps : '—'}</b>cursor render fps</span>
      <span><b>{status.camera === 'on' ? ms(status.inferenceP95Ms) : '—'}</b>model p95</span>
      <span><b>{status.camera === 'on' ? ms(status.processingMs) : '—'}</b>processing mean</span>
      <span><b>{last ? ms(last.metrics.eventToPaintP95Ms) : '—'}</b>event → updated UI frame p95</span>
    </div>
    <p>Model and processing timings measure software work. Trial cue → action includes your reaction and motion. Physical motion-to-screen latency requires external measurement.</p>
    <div className="lab-session-notes"><label>Conditions / device notes <input value={a.notes} onChange={e => a.setNotes(e.target.value)} placeholder="Lighting, distance, camera, hand…" /></label>
      <label>How seamless did it feel? <select value={a.smoothness} onChange={e => a.setSmoothness(e.target.value)}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} / 5</option>)}</select></label></div>
    <table><caption>Functional results match the expected action, target and UI change. Untested features are never treated as passing.</caption><thead><tr><th>Feature</th><th>Live camera</th><th>Synthetic replay</th></tr></thead><tbody>{features.map(f => {
      const cell = source => {
        const rows = a.results.filter(r => r.spec.id === f.id && r.source === source);
        const eligible = rows.filter(r => r.outcome !== 'incomplete');
        return rows.length ? `${eligible.filter(r => r.outcome === 'pass').length}/${eligible.length} passed · last ${rows.at(-1).outcome}` : 'Not tested';
      };
      return <tr key={f.id} data-feature-result={f.id}><th>{f.label}</th><td>{cell('hand')}</td><td>{cell('replay')}</td></tr>;
    })}</tbody></table>
    {last && <div className="lab-result" data-testid="trial-result" data-outcome={last.outcome}><h3>{last.spec.label}: {last.outcome.toUpperCase()} <small>({last.source === 'hand' ? 'live camera' : 'synthetic'})</small></h3>
      <p>{last.missed} missed expected actions · {last.duplicates} duplicates · {last.unexpectedCount} unexpected actions · {last.failedEffects} missing UI changes</p>
      {last.outcome === 'fail' && <ul>{last.failures.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <p>Required hand coverage: {last.metrics.requiredHandCoverage == null ? '—' : `${Math.round(last.metrics.requiredHandCoverage * 100)}%`} · result gap p95: {ms(last.metrics.resultGapP95Ms)} · cue → first expected action: {ms(last.metrics.cueToFirstActionMs)}</p>
      {last.spec.id === 'point' && <p>Target error p95: {last.metrics.pointErrorP95Px ?? '—'} px · stationary pointer RMS: {last.metrics.pointerJitterRmsPx ?? '—'} px · longest target hold: {ms(last.metrics.bestDwellMs)}</p>}
      {last.outcome === 'incomplete' && <p>Excluded from pass rates: {last.truncated ? 'recording limit reached' : last.reason !== 'finished' ? last.reason : 'no input frames received'}.</p>}
    </div>}
    <p>Functional passes do not certify production readiness. Repeat live trials with each hand, varied lighting, distance, occlusion and target sizes. Zoom and speech capture remain future features.</p>
  </section>;
}
