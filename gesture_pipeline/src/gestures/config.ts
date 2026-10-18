// Every tunable number lives here. Dev overrides from the tuning panel are kept in localStorage.
// When a tuned value wins, paste it into `defaults` and commit.

export const defaults = {
  camera: { width: 640, height: 480, fps: 30 },
  mp: {
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    numHands: 2,
  },
  hands: { minArea: 0.003, sameHandDist: 0.3, switchAfterMs: 300, enterMs: 100, handLostMs: 250, swapHandedness: false, minHandednessConfidence: 0.65 },
  bimanual: { armMs: 100, minStartGap: 0.12, minTravel: 0.07, closeGap: 0.16, dominance: 1.4 },
  mapping: { mirror: true, boxLeft: 0.15, boxRight: 0.85, boxTop: 0.12, boxBottom: 0.7, idleBelowY: 1 },
  smoothing: { minCutoff: 1.0, beta: 0.015, dCutoff: 1.0, releaseBlendMs: 90 },
  presentation: { responseMs: 18 },
  pinch: { on: 0.25, off: 0.4, confirmMs: 35, releaseMs: 50 },
  drag: { minDist: 0.025, armMs: 100, pointerMinPx: 8 },
  swipe: { on: 0.5, off: 0.75, maxMiddleExtension: 1.25, armMs: 70, releaseMs: 120, minDist: 0.09, dominance: 1.5 },
  scroll: { gain: 2, deadband: 0.003 },
  hover: { stickyMs: 120 },
  cooldownMs: 180,
  perf: { slowInferenceMs: 33, maxResultAgeMs: 180 },
};

export type Config = typeof defaults;

// Versioned so old saved thresholds do not silently defeat the new interaction rules.
const KEY = 'conjure.gesture.config.v3';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge(base: any, over: any, prefix = ''): any {
  if (!isObj(over)) return base;
  for (const k of Object.keys(over)) {
    if (!Object.hasOwn(base, k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isObj(base[k]) && isObj(over[k])) merge(base[k], over[k], path);
    else if (typeof base[k] === 'number' && typeof over[k] === 'number' && Number.isFinite(over[k])) {
      const [min, max, integer] = bounds[path] ?? [0, 10000];
      const value = Math.min(max, Math.max(min, over[k] as number));
      base[k] = integer ? Math.round(value) : value;
    } else if (typeof base[k] === 'boolean' && typeof over[k] === 'boolean') base[k] = over[k];
  }
  return base;
}

// Bound persisted and UI values too: a stale slider or malformed import must not disable hysteresis.
const bounds: Record<string, [number, number, boolean?]> = {
  'camera.width': [160, 1920, true], 'camera.height': [120, 1080, true], 'camera.fps': [10, 60, true],
  'mp.minHandDetectionConfidence': [0.01, 1], 'mp.minHandPresenceConfidence': [0.01, 1], 'mp.minTrackingConfidence': [0.01, 1], 'mp.numHands': [1, 2, true],
  'hands.minArea': [0.0001, 0.5], 'hands.sameHandDist': [0.01, 1], 'hands.switchAfterMs': [0, 3000], 'hands.enterMs': [0, 500], 'hands.handLostMs': [50, 2000],
  'hands.minHandednessConfidence': [0.5, 0.99],
  'bimanual.armMs': [35, 1000], 'bimanual.minStartGap': [0.04, 0.5], 'bimanual.minTravel': [0.02, 0.3], 'bimanual.closeGap': [0.03, 0.3], 'bimanual.dominance': [1.1, 3],
  'mapping.boxLeft': [0, 0.9], 'mapping.boxRight': [0.1, 1], 'mapping.boxTop': [0, 0.9], 'mapping.boxBottom': [0.1, 1], 'mapping.idleBelowY': [0.1, 1],
  'smoothing.minCutoff': [0.01, 10], 'smoothing.beta': [0, 1], 'smoothing.dCutoff': [0.01, 10], 'smoothing.releaseBlendMs': [1, 1000],
  'presentation.responseMs': [0, 100], 'pinch.on': [0.01, 1], 'pinch.off': [0.02, 2], 'pinch.confirmMs': [0, 150], 'pinch.releaseMs': [0, 500],
  'drag.minDist': [0.005, 0.5], 'drag.armMs': [0, 1000], 'drag.pointerMinPx': [1, 100],
  'swipe.on': [0.01, 1], 'swipe.off': [0.02, 2], 'swipe.maxMiddleExtension': [0.5, 2], 'swipe.armMs': [0, 500], 'swipe.releaseMs': [10, 1000], 'swipe.minDist': [0.01, 0.5], 'swipe.dominance': [1, 5],
  'scroll.gain': [0.1, 10], 'scroll.deadband': [0, 0.1], 'hover.stickyMs': [0, 1000], 'cooldownMs': [0, 2000],
  'perf.slowInferenceMs': [5, 100], 'perf.maxResultAgeMs': [50, 1000],
};

export function normalizeConfig(overrides: unknown): Config {
  const c = merge(clone(defaults), overrides) as Config;
  if (c.pinch.off <= c.pinch.on) c.pinch = { ...c.pinch, on: defaults.pinch.on, off: defaults.pinch.off };
  if (c.swipe.off <= c.swipe.on) c.swipe = { ...c.swipe, on: defaults.swipe.on, off: defaults.swipe.off };
  if (c.mapping.boxRight - c.mapping.boxLeft < 0.1) { c.mapping.boxLeft = defaults.mapping.boxLeft; c.mapping.boxRight = defaults.mapping.boxRight; }
  if (c.mapping.boxBottom - c.mapping.boxTop < 0.1) { c.mapping.boxTop = defaults.mapping.boxTop; c.mapping.boxBottom = defaults.mapping.boxBottom; }
  return c;
}

function load(): Config {
  const c = clone(defaults);
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return normalizeConfig(JSON.parse(raw));
  } catch {
    /* storage blocked: use defaults */
  }
  return c;
}

/** The live config object. Mutated in place by the tuning panel so the running loop sees changes instantly. */
export const config: Config = load();

type Listener = () => void;
const listeners = new Set<Listener>();
export function onConfigChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPath(path: string): unknown {
  return path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), config);
}

export function setPath(path: string, value: number | boolean) {
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  if (!bounds[path] && path !== 'mapping.mirror' && path !== 'hands.swapHandedness') return;
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<any>((o, k) => o[k], config);
  const candidate = clone(config);
  const candidateParent = keys.reduce<any>((o, k) => o[k], candidate);
  if (typeof candidateParent[last] !== typeof value) return;
  candidateParent[last] = value;
  // Reject inverted pairs instead of silently breaking a running interaction.
  if (candidate.pinch.off <= candidate.pinch.on || candidate.swipe.off <= candidate.swipe.on
    || candidate.mapping.boxRight - candidate.mapping.boxLeft < 0.1 || candidate.mapping.boxBottom - candidate.mapping.boxTop < 0.1) {
    listeners.forEach(l => l()); return;
  }
  parent[last] = keys.reduce<any>((o, k) => o[k], normalizeConfig(candidate))[last];
  save();
  listeners.forEach(l => l());
}

/** Only the values that differ from defaults, for copying into config.ts. */
export function overrides(): Record<string, unknown> {
  const diff = (a: any, b: any): any => {
    if (!isObj(a)) return JSON.stringify(a) === JSON.stringify(b) ? undefined : a;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a)) {
      const d = diff(a[k], b?.[k]);
      if (d !== undefined && !(isObj(d) && Object.keys(d).length === 0)) out[k] = d;
    }
    return out;
  };
  return diff(config, defaults) ?? {};
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides()));
  } catch {
    /* ignore */
  }
}

export function resetConfig() {
  merge(config, clone(defaults));
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach(l => l());
}
