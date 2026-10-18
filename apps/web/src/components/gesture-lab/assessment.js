// Trial ground truth is explicit: a selected task, target, hand and input source.
// These measurements cannot establish physical motion-to-photon latency.
export const features = [
  { id: 'expand', label: 'Expand / rip', instruction: 'Pinch the primary original with both hands, then pull your left hand left and right hand right.', pair: true },
  { id: 'collapse', label: 'Collapse group', instruction: 'The group is already expanded. Pinch left and right components in this group with thumb and index finger, then bring both hands toward the middle.', pair: true },
  { id: 'compare', label: 'Compare originals', instruction: 'Pinch one original per hand and bring both hands horizontally together.', pair: true },
  { id: 'point', label: 'Point / cursor precision', instruction: 'Keep the selected index pointer inside the centre target for at least one continuous second. Keep that finger still.' },
  { id: 'click', label: 'Pinch click', instruction: 'Point at Select item, pinch thumb + index, then release without moving. It should activate exactly once.' },
  { id: 'drag', label: 'Pinch drag / drop', instruction: 'Pinch the primary tile. Hold and move it into the drop tray, then release.' },
  { id: 'reveal', label: 'Swipe left / reveal', instruction: 'On the navigation surface, pinch thumb + index and swipe right to left. The primary object should appear once.' },
  { id: 'dismiss', label: 'Swipe right / dismiss', instruction: 'On the primary card, pinch thumb + index and swipe left to right. The card should disappear once.' },
  { id: 'scroll-up', label: 'Swipe up / browse forward', instruction: 'Start over the catalogue, pinch thumb + index and swipe up. The catalogue should scroll toward later items.' },
  { id: 'scroll-down', label: 'Swipe down / browse backward', instruction: 'The catalogue starts halfway down. Pinch thumb + index and swipe down to return to earlier items.' },
  { id: 'fist', label: 'Fist grab / release', instruction: 'Point at Select item, close a full fist to highlight it, then open to activate it once.' },
  { id: 'parallel', label: 'Independent simultaneous drags', instruction: 'Grab one tile with each hand, drag both into the tray, then release. Both must drop independently.', pair: true },
  { id: 'recovery', label: 'Tracking loss / recovery', instruction: 'Begin dragging both tiles. Hide your left hand for over 250 ms; finish the right-hand drop. Left cancels, right finishes.', pair: true },
  { id: 'idle', label: 'No-action / false activations', instruction: 'Move open hands normally for at least five seconds without pinching or making a fist. Nothing should activate.' },
];
const rule = (type, fields = {}) => ({ type, ...fields });
export function trialSpec(feature, hand = 'right') {
  const spec = features.find(f => f.id === feature);
  if (!spec) throw new Error(`Unknown feature: ${feature}`);
  const expected = {
    expand: [rule('expand', { group_id: 'alpine' })], collapse: [rule('collapse', { group_id: 'alpine' })],
    compare: [rule('compare', { target_ids: ['alpine', 'camp'] })],
    point: [], click: [rule('select', { target_id: 'lab-click', hand_id: hand })],
    drag: [rule('drop', { target_id: 'lab-drag-left', drop_target_id: 'lab-tray', hand_id: hand })],
    reveal: [rule('reveal', { hand_id: hand })], dismiss: [rule('dismiss', { target_id: 'lab-card', hand_id: hand })],
    'scroll-up': [rule('scroll', { sign: 1, hand_id: hand })], 'scroll-down': [rule('scroll', { sign: -1, hand_id: hand })],
    fist: [rule('release', { target_id: 'lab-click', hand_id: hand })],
    parallel: ['left', 'right'].map((hand_id, i) => rule('drop', { hand_id, target_id: `lab-drag-${i ? 'right' : 'left'}`, drop_target_id: 'lab-tray' })),
    recovery: [rule('cancel', { hand_id: 'left', target_id: 'lab-drag-left' }), rule('drop', { hand_id: 'right', target_id: 'lab-drag-right', drop_target_id: 'lab-tray' })],
    idle: [],
  }[feature];
  const allowed = {
    click: ['pointer_down'], drag: ['pointer_down', 'drag_start'], fist: ['grab'],
    reveal: ['pointer_down'], dismiss: ['pointer_down'], 'scroll-up': ['pointer_down'], 'scroll-down': ['pointer_down'],
    parallel: ['pointer_down', 'drag_start'], recovery: ['pointer_down', 'drag_start'],
  }[feature] ?? [];
  return { ...spec, hand, expected, allowed, minDurationMs: feature === 'idle' ? 5000 : 0 };
}
const actions = new Set(['pointer_down', 'select', 'drag_start', 'drop', 'reveal', 'dismiss', 'scroll', 'expand', 'collapse', 'compare', 'grab', 'release', 'cancel']);
const matches = (e, r) => Object.entries(r).every(([key, value]) => key === 'sign'
  ? Math.sign(e.delta_y ?? 0) === value
  : key === 'target_ids' ? Array.isArray(e.target_ids) && [...e.target_ids].sort().join('|') === [...value].sort().join('|') : e[key] === value);
export const percentile = (values, p = .95) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const rounded = n => n === null ? null : Math.round(n * 10) / 10;

export class TrialRecorder {
  current = null;
  results = [];
  begin(spec, source, now, context = {}) {
    if (this.current) throw new Error('Finish or cancel the current trial first.');
    this.current = { id: `trial-${Date.now()}-${this.results.length}`, spec, source, startedAt: now, context,
      events: [], frames: [], hits: spec.expected.map(() => []), unexpected: [], paints: {}, dwellMs: 0, bestDwellMs: 0,
      pointErrors: [], stablePoints: [], lastPointT: null, truncated: false };
    return this.current;
  }
  observeEvent(event) {
    const t = this.current;
    if (!t || event.source !== t.source) return;
    if (t.events.length >= 3000) { t.truncated = true; return; }
    t.events.push({ ...event });
    const index = t.spec.expected.findIndex(r => matches(event, r));
    if (index >= 0) t.hits[index].push(event);
    else if (actions.has(event.type)) {
      const targets = t.spec.expected.map(r => r.target_id).filter(Boolean);
      const allowed = t.spec.allowed.includes(event.type) && (!targets.length || targets.includes(event.target_id))
        && (t.spec.pair || !event.hand_id || event.hand_id === t.spec.hand);
      if (!allowed) t.unexpected.push(event);
    }
    return index;
  }
  observeFrame(sample, pointTarget = null) {
    const t = this.current;
    if (!t || sample.source !== t.source) return;
    if (t.frames.length >= 10000) { t.truncated = true; return; }
    t.frames.push(sample);
    if (t.spec.id !== 'point') return;
    const hand = sample.hands[t.spec.hand], p = hand?.pointer;
    const error = p && pointTarget ? Math.hypot((p.x - pointTarget.x) * pointTarget.width, (p.y - pointTarget.y) * pointTarget.height) : null;
    if (error !== null) t.pointErrors.push(error);
    const dt = t.lastPointT === null ? 0 : sample.t - t.lastPointT;
    if (hand?.present && hand.identified && error !== null && error <= pointTarget.radius && dt >= 0 && dt <= 150) {
      t.dwellMs += dt;
      t.stablePoints.push({ x: p.x * pointTarget.width, y: p.y * pointTarget.height });
    } else t.dwellMs = 0;
    t.bestDwellMs = Math.max(t.bestDwellMs, t.dwellMs);
    t.lastPointT = sample.t;
  }
  markPaint(eventId, at, applied) {
    if (this.current?.hits.flat().some(e => e.event_id === eventId)) this.current.paints[eventId] = { at, applied };
  }
  finish(now, { reason = 'finished', smoothness = null, notes = '' } = {}) {
    const t = this.current;
    if (!t) return null;
    const relevant = t.frames;
    const duplicates = t.hits.reduce((n, hits) => n + Math.max(0, hits.length - 1), 0);
    const missed = t.hits.filter(hits => !hits.length).length;
    const failedEffects = t.hits.flat().filter(e => !t.paints[e.event_id]?.applied).length;
    const enough = now - t.startedAt >= t.spec.minDurationMs;
    const pointing = t.spec.id !== 'point' || t.bestDwellMs >= 1000;
    const gaps = relevant.length ? [relevant[0].receivedAt - t.startedAt,
      ...relevant.slice(1).map((f, i) => f.receivedAt - relevant[i].receivedAt), now - relevant.at(-1).receivedAt].filter(n => n >= 0) : [];
    const required = t.spec.pair ? ['left', 'right'] : [t.spec.hand];
    const coverage = relevant.length ? relevant.filter(f => required.every(id => f.hands[id]?.present && f.hands[id].identified)).length / relevant.length : null;
    const pass = enough && pointing && !missed && !duplicates && !t.unexpected.length && !failedEffects
      && (!['idle', 'point'].includes(t.spec.id) || coverage >= .8);
    const failures = [!enough && 'Trial ended before the minimum observation time.', !pointing && 'Pointer did not stay in the target for one continuous second.',
      missed > 0 && 'Expected action was missed.', duplicates > 0 && 'An expected action fired more than once.',
      t.unexpected.length > 0 && 'An unintended action, hand or target was observed.', failedEffects > 0 && 'The expected UI change was not confirmed.',
      ['idle', 'point'].includes(t.spec.id) && coverage < .8 && 'Required hand identification was below 80% of observed results.'].filter(Boolean);
    const paints = t.hits.flat().map(e => t.paints[e.event_id] ? t.paints[e.event_id].at - e.ts : null).filter(n => n !== null && n >= 0);
    const mx = mean(t.stablePoints.map(p => p.x)), my = mean(t.stablePoints.map(p => p.y));
    const jitter = t.stablePoints.length ? Math.sqrt(mean(t.stablePoints.map(p => (p.x - mx) ** 2 + (p.y - my) ** 2))) : null;
    const result = { ...t, finishedAt: now, durationMs: now - t.startedAt, reason,
      outcome: reason !== 'finished' || !relevant.length || t.truncated ? 'incomplete' : pass ? 'pass' : 'fail',
      duplicates, missed, unexpectedCount: t.unexpected.length, failedEffects, failures, smoothness, notes,
      metrics: { inferenceP95Ms: rounded(percentile(relevant.map(f => f.inferenceMs))), processingP95Ms: rounded(percentile(relevant.map(f => f.processingMs))),
        resultGapP95Ms: rounded(percentile(gaps)), maxResultGapMs: rounded(gaps.length ? Math.max(...gaps) : null),
        requiredHandCoverage: coverage, eventToPaintP95Ms: rounded(percentile(paints)),
        cueToFirstActionMs: t.hits.flat().length ? Math.min(...t.hits.flat().map(e => e.ts)) - t.startedAt : null,
        pointErrorP95Px: rounded(percentile(t.pointErrors)), pointerJitterRmsPx: rounded(jitter), bestDwellMs: t.bestDwellMs,
      } };
    this.results.push(result);
    // Bound the session. The export states that earlier trials were removed.
    if (this.results.length > 100) { this.results.shift(); this.discardedTrials = (this.discardedTrials ?? 0) + 1; }
    this.current = null;
    return result;
  }
  export(context = {}) {
    return { version: 1, exportedAt: new Date().toISOString(), context, discardedTrials: this.discardedTrials ?? 0,
      limits: { physicalLatencyMeasured: false, note: 'Camera, synthetic replay and mouse inputs are separate. Functional pass is task matching, not a production-readiness score.' }, results: this.results };
  }
}
