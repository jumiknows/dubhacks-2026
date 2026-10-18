// The impure side: camera, MediaPipe, clock, hit-testing, DOM cursor. Wires everything to the pure engine.

import { gestureBus, makeEvent } from './bus';
import { startCamera, stopCamera } from './camera';
import { config, type Config } from './config';
import { initialState, interactionActive, step, type EngineOutput, type EngineState } from './engine';
import { extract } from './features';
import { initialPrimary, selectPrimary, type PrimaryState } from './hands';
import { activateTarget, dropTargetAt, markPressed, scrollTargetAt, targetAt } from './hitTest';
import { PoseDetector } from './pose';
import { PointerMapper } from './mapping';
import { CursorPresentation } from './presentation';
import { createRecognizer, type HandTracker } from './recognizer';
import type { FixtureFrame } from './replay';
import type { Features, FrameInput, GestureStatus, Intent } from './types';

export type DebugInfo = {
  frame: FrameInput;
  primary: FrameInput['hands'][number] | null;
  features: Features | null;
  out: EngineOutput;
  cursor: { x: number; y: number } | null;
};

const CHIP: Partial<Record<Intent['type'], string>> = {
  reveal: 'Next product',
  select: 'Select',
  drag_start: 'Dragging',
  drop: 'Dropped',
  dismiss: 'Dismissed',
  cancel: 'Cancel',
};

export class GestureController {
  private video: HTMLVideoElement | null = null;
  private recognizer: HandTracker | null = null;
  private recognizerSettings = '';
  private engine: EngineState = initialState();
  private primary: PrimaryState = initialPrimary();
  private mapper = new PointerMapper();
  private poses = new PoseDetector();
  private grabTarget: string | null = null;
  private generation = 0;
  private starting = false;
  private startAbort: AbortController | null = null;
  private cancelScheduled: (() => void) | null = null;
  private running = false;
  private busy = false;
  private lastVideoTime = -1;
  private cursorEl: HTMLElement | null = null;
  private chipEl: HTMLElement | null = null;
  private chipUntil = 0;
  private debugDrawer: ((d: DebugInfo) => void) | null = null;
  private recording: FixtureFrame[] | null = null;
  private recordingSettings: Config | null = null;
  private lastCursor: { x: number; y: number } | null = null;
  private presentation = new CursorPresentation();
  private renderTicket: number | null = null;
  private renderOut: EngineOutput | null = null;
  private lastResultAt = 0;
  private renderTimes: number[] = [];

  // metrics
  private frameTimes: number[] = [];
  private inferEma = 0;
  private processingEma = 0;
  private inferenceSamples: { t: number; ms: number }[] = [];
  private detections: { t: number; hit: boolean }[] = [];

  private snapshot: GestureStatus = {
    camera: 'off',
    delegate: null,
    backend: null,
    handPresent: false,
    detectedHands: 0,
    trackingState: 'no_hand',
    videoWidth: 0,
    videoHeight: 0,
    fps: 0,
    renderFps: 0,
    inferenceMs: 0,
    inferenceP95Ms: 0,
    processingMs: 0,
    detectionRate: 0,
    lighting: 'ok',
    recording: false,
    error: null,
  };
  private statusListeners = new Set<() => void>();
  private lastPublish = 0;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }
  private onVisibility = () => {
    if (document.hidden && this.running) this.stop(true);
    else if (!document.hidden && this.resumeOnVisible) void this.start();
  };
  private resumeOnVisible = false;

  // ---------- public API ----------
  attachVideo(el: HTMLVideoElement | null) {
    this.video = el;
  }
  setCursorElement(el: HTMLElement | null, chip: HTMLElement | null) {
    this.cursorEl = el;
    this.chipEl = chip;
  }
  setDebugDrawer(fn: ((d: DebugInfo) => void) | null) {
    this.debugDrawer = fn;
  }
  subscribe = (fn: () => void) => {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  };
  getStatus = () => this.snapshot;
  get lastCursorPos() {
    return this.lastCursor;
  }

  async start() {
    if (this.running || this.starting) return;
    const video = this.video;
    if (!video) {
      this.setStatus({ camera: 'error', error: 'No video element attached. Mount <GestureProvider> first.' });
      return;
    }
    const generation = ++this.generation;
    const abort = new AbortController();
    this.startAbort = abort;
    this.starting = true;
    this.setStatus({ camera: 'starting', error: null });
    try {
      const camera = await startCamera(video, abort.signal);
      if (generation !== this.generation) return;
      if (camera !== 'on') {
        this.setStatus({ camera, error: cameraMessage(camera) });
        return;
      }
      const settings = JSON.stringify(config.mp);
      if (this.recognizer && settings !== this.recognizerSettings) {
        this.recognizer.close();
        this.recognizer = null;
      }
      if (!this.recognizer) {
        const { recognizer, delegate, backend } = await createRecognizer(abort.signal);
        if (generation !== this.generation) { recognizer.close(); return; }
        this.recognizer = recognizer;
        this.recognizerSettings = settings;
        this.setStatus({ delegate, backend: backend ?? 'main' });
      }
      this.running = true;
      this.resumeOnVisible = false;
      this.lastVideoTime = -1;
      this.frameTimes = []; this.detections = []; this.inferEma = 0;
      this.renderTimes = []; this.inferenceSamples = []; this.processingEma = 0;
      this.setStatus({ camera: 'on', videoWidth: video.videoWidth, videoHeight: video.videoHeight });
      this.startPresentation();
      this.schedule();
    } catch (error) {
      if (generation !== this.generation) return;
      console.error(error);
      stopCamera(video);
      this.setStatus({ camera: 'error', error: 'Hand tracking failed to load. Use mouse or keyboard.' });
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  stop(resumeLater = false) {
    this.generation++;
    this.startAbort?.abort(); this.startAbort = null;
    this.starting = false; this.busy = false;
    this.recognizer?.close(); this.recognizer = null;
    this.recognizerSettings = '';
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    if (this.renderTicket !== null) cancelAnimationFrame(this.renderTicket);
    this.renderTicket = null;
    this.renderOut = null;
    this.presentation.reset();
    this.cancelInteraction();
    this.running = false;
    this.resumeOnVisible = resumeLater;
    if (this.video) stopCamera(this.video);
    this.engine = initialState();
    this.primary = initialPrimary();
    this.mapper.reset();
    this.renderCursor(null, null);
    this.setStatus({ camera: 'off', handPresent: false, detectedHands: 0, trackingState: 'no_hand', fps: 0, renderFps: 0 });
  }

  cancelInteraction(emit = true) {
    if (interactionActive(this.engine)) {
      if (this.engine.pinchTarget) gestureBus.emit(makeEvent('pointer_up', 'hand', { target_id: this.engine.pinchTarget }));
      if (emit) gestureBus.emit(makeEvent('cancel', 'hand', { target_id: this.engine.pinchTarget }));
    }
    this.engine = { ...initialState(), blockedUntilOpen: true };
  }

  dispose() {
    this.stop();
    this.recognizer?.close();
    this.recognizer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  startRecording() {
    this.recording = [];
    this.recordingSettings = JSON.parse(JSON.stringify(config));
    this.setStatus({ recording: true });
  }
  stopRecording(): FixtureFrame[] {
    const frames = this.recording ?? [];
    this.recording = null;
    this.setStatus({ recording: false });
    return frames;
  }
  get recordingConfig(): Config | undefined {
    return this.recordingSettings ? JSON.parse(JSON.stringify(this.recordingSettings)) : undefined;
  }

  // ---------- loop ----------
  private schedule() {
    if (!this.running || !this.video) return;
    const video = this.video;
    const generation = this.generation;
    const callback = () => {
      this.cancelScheduled = null;
      if (generation === this.generation) this.onFrame();
    };
    if (typeof video.requestVideoFrameCallback === 'function') {
      const ticket = video.requestVideoFrameCallback(callback);
      this.cancelScheduled = () => video.cancelVideoFrameCallback(ticket);
    } else {
      const ticket = requestAnimationFrame(callback);
      this.cancelScheduled = () => cancelAnimationFrame(ticket);
    }
  }

  private onFrame = () => {
    this.processLatest();
    this.schedule();
  };

  private processLatest() {
    if (!this.running || !this.video) return;
    const v = this.video;
    const isNewFrame = v.currentTime !== this.lastVideoTime;
    if (v.readyState >= 2 && isNewFrame && !this.busy && this.recognizer) {
      this.lastVideoTime = v.currentTime;
      this.busy = true;
      const generation = this.generation;
      void this.process(v).catch(error => {
        if (generation !== this.generation) return;
        console.error('[gestures] frame failed', error);
        this.stop();
        this.recognizer?.close(); this.recognizer = null;
        this.setStatus({ camera: 'error', error: 'Hand tracking stopped responding. Start again to retry.' });
      }).finally(() => {
        if (generation !== this.generation) return;
        this.busy = false;
        // Use the newest camera frame immediately, rather than waiting for another video callback.
        this.processLatest();
      });
    }
  }

  private async process(v: HTMLVideoElement) {
    const t = performance.now();
    const generation = this.generation;
    const tracker = this.recognizer!;
    const hands = await tracker.detect(v, t);
    if (generation !== this.generation || !this.running) return;
    const processingMs = performance.now() - t;
    const inferMs = tracker.inferenceMs ?? processingMs;
    const frame: FrameInput = { t, hands: processingMs <= config.perf.maxResultAgeMs ? hands : [], videoW: v.videoWidth || config.camera.width, videoH: v.videoHeight || config.camera.height };
    this.processFrame(frame, inferMs, processingMs);
  }

  /** The live and browser-test/replay entry point for already detected landmarks. */
  processFrame(frame: FrameInput, inferMs = 0, processingMs = inferMs) {
    const { t, hands } = frame;
    const generation = this.generation;
    this.lastResultAt = performance.now();

    const sel = selectPrimary(frame, this.primary, config.hands);
    this.primary = sel.state;
    if (sel.switched) {
      if (interactionActive(this.engine)) this.cancelInteraction();
      this.mapper.reset();
      this.presentation.reset();
    }
    const f = sel.hand ? extract(sel.hand, frame.videoW, frame.videoH) : null;

    let cursor: { x: number; y: number } | null = null;
    let hovered: string | null = null;
    let draggable = false;
    let swipeTargetId: string | null = null;
    if (f) {
      const releasing = ['pinchPending', 'dragging'].includes(this.engine.mode) && f.pinchRatio >= config.pinch.off;
      cursor = this.mapper.update(f, t, innerWidth, innerHeight, config, releasing);
      if (this.running && this.renderTicket !== null) {
        this.presentation.update(cursor, performance.now(), config.presentation.responseMs);
        cursor = this.presentation.sample(performance.now(), config.presentation.responseMs) ?? cursor;
      }
      const target = targetAt(cursor.x, cursor.y);
      hovered = target?.id ?? null;
      draggable = target?.draggable ?? false;
      swipeTargetId = target?.cardId ?? null;
    }

    const input = { t, hand: f, hoveredId: hovered, draggable, swipeTargetId,
      scrollTargetId: cursor ? scrollTargetAt(cursor.x, cursor.y) : null,
      pointer: cursor ? { x: cursor.x / innerWidth, y: cursor.y / innerHeight } : undefined,
      dropTargetId: cursor ? dropTargetAt(cursor.x, cursor.y, this.engine.pinchTarget) : null,
    };
    if (this.recording) this.recording.push({
      t: Math.round(t),
      hands: frame.hands.map(h => ({ landmarks: h.landmarks.map(p => [r4(p.x), r4(p.y), r4(p.z)]), handedness: h.handedness })),
      hit: { targetId: hovered, draggable, swipeTargetId, dropTargetId: input.dropTargetId, scrollTargetId: input.scrollTargetId },
      timing: { inferenceMs: r4(inferMs), processingMs: r4(processingMs) },
    });
    if (sel.hand && f) {
      const named = this.poses.update(sel.hand.landmarks, t, config.mapping.mirror, {
        width: frame.videoW,
        height: frame.videoH,
      });
      if (named === 'swipe-left') gestureBus.emit(makeEvent('reveal', 'hand', { x: (cursor?.x ?? 0) / innerWidth, y: (cursor?.y ?? 0) / innerHeight }));
      if (named === 'swipe-right') gestureBus.emit(makeEvent('dismiss', 'hand', { target_id: swipeTargetId, x: (cursor?.x ?? 0) / innerWidth, y: (cursor?.y ?? 0) / innerHeight }));
      if (named === 'swipe-up' || named === 'swipe-down') {
        gestureBus.emit(makeEvent('scroll', 'hand', {
          target_id: input.scrollTargetId,
          delta_y: named === 'swipe-up' ? 0.12 : -0.12,
          x: (cursor?.x ?? 0) / innerWidth,
          y: (cursor?.y ?? 0) / innerHeight,
        }));
      }
      if (named === 'grab' && hovered) {
        this.grabTarget = hovered;
        markPressed(hovered, true);
      }
      if (named === 'release') {
        if (this.grabTarget) activateTarget(this.grabTarget);
        markPressed(this.grabTarget ?? hovered, false);
        this.grabTarget = null;
      }
    } else if (!f) this.poses.reset();

    const out = step(this.engine, input, config);
    this.engine = out.state;
    if (cursor) this.lastCursor = cursor;

    for (const intent of out.intents) {
      if (intent.type === 'drag_move' && this.running && this.renderTicket !== null) continue;
      // Swipes come from a pinched two-finger drag. A three-finger pinch is not a gesture.
      if (intent.type === 'reveal' || intent.type === 'dismiss' || intent.type === 'scroll') continue;
      const pos = cursor ?? this.lastCursor ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const e = makeEvent(intent.type, 'hand', {
        x: pos.x / window.innerWidth,
        y: pos.y / window.innerHeight,
        confidence: f ? 1 : 0,
        target_id: 'target_id' in intent ? intent.target_id : undefined,
        drop_target_id: 'drop_target_id' in intent ? intent.drop_target_id : undefined,
        start_x: 'start_x' in intent ? intent.start_x : undefined,
        start_y: 'start_y' in intent ? intent.start_y : undefined,
        delta_y: 'delta_y' in intent ? intent.delta_y : undefined,
      });
      gestureBus.emit(e);
      // A native Stop/Reset button can be activated synchronously by a select event.
      if (generation !== this.generation) return;
      const chip = CHIP[intent.type];
      if (chip) this.showChip(chip, t);
    }

    this.renderOut = out;
    if (!this.running || this.renderTicket === null) this.renderCursor(out.cursorVisible ? cursor ?? this.lastCursor : null, out, performance.now());
    this.trackMetrics(t, inferMs, processingMs, !!f, {
      detectedHands: hands.length,
      trackingState: sel.reason ?? (f && f.palmCenter.y >= config.mapping.idleBelowY ? 'resting' : 'tracking'),
    });
    this.debugDrawer?.({ frame, primary: sel.hand, features: f, out, cursor });
  }

  // ---------- rendering (direct DOM writes, never React state) ----------
  private startPresentation() {
    if (typeof requestAnimationFrame !== 'function' || this.renderTicket !== null) return;
    const paint = (now: number) => {
      if (!this.running) { this.renderTicket = null; return; }
      this.renderTimes.push(now);
      while (this.renderTimes.length && now - this.renderTimes[0] > 1000) this.renderTimes.shift();
      const stale = now - this.lastResultAt > config.perf.maxResultAgeMs;
      if (stale && interactionActive(this.engine)) this.cancelInteraction();
      const pos = this.presentation.sample(now, config.presentation.responseMs);
      if (!stale && this.renderOut?.cursorVisible && pos) {
        this.lastCursor = pos;
        this.renderCursor(pos, this.renderOut, now);
        if (this.engine.mode === 'dragging' && this.engine.releaseSince === null) {
          gestureBus.emit(makeEvent('drag_move', 'hand', { target_id: this.engine.pinchTarget,
            x: pos.x / innerWidth, y: pos.y / innerHeight, start_x: this.engine.pressPointer!.x, start_y: this.engine.pressPointer!.y }));
        }
      } else this.renderCursor(null, null, now);
      this.renderTicket = requestAnimationFrame(paint);
    };
    this.renderTicket = requestAnimationFrame(paint);
  }
  private renderCursor(pos: { x: number; y: number } | null, out: EngineOutput | null, t = performance.now()) {
    const el = this.cursorEl;
    if (!el) return;
    if (!pos || !out) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '1';
    el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    el.dataset.mode = out.state.mode;
    el.dataset.pinched = out.state.pinched ? 'true' : 'false';
    el.dataset.hover = out.state.hoverId ? 'true' : 'false';
    el.style.setProperty('--hold', String(out.swipe?.progress ?? 0));
    if (out.swipe) this.showChip(out.swipe.label, t, 120);
    if (this.chipEl && t > this.chipUntil) this.chipEl.textContent = '';
  }

  private showChip(text: string, t: number, ms = 800) {
    if (!this.chipEl) return;
    this.chipEl.textContent = text;
    this.chipUntil = t + ms;
  }

  // ---------- metrics and status ----------
  private trackMetrics(t: number, inferMs: number, processingMs: number, hit: boolean, tracking: Pick<GestureStatus, 'detectedHands' | 'trackingState'>) {
    this.frameTimes.push(t);
    while (this.frameTimes.length && t - this.frameTimes[0] > 1000) this.frameTimes.shift();
    this.inferEma = this.inferEma === 0 ? inferMs : this.inferEma * 0.9 + inferMs * 0.1;
    this.processingEma = this.processingEma === 0 ? processingMs : this.processingEma * 0.9 + processingMs * 0.1;
    this.inferenceSamples.push({ t, ms: inferMs });
    while (this.inferenceSamples.length && t - this.inferenceSamples[0].t > 2000) this.inferenceSamples.shift();
    this.detections.push({ t, hit });
    while (this.detections.length && t - this.detections[0].t > 2000) this.detections.shift();
    const rate = this.detections.filter(d => d.hit).length / Math.max(1, this.detections.length);

    const sawAny = this.detections.some(d => d.hit);
    const lighting: GestureStatus['lighting'] = sawAny && rate < 0.5 ? 'low' : 'ok';
    if (t - this.lastPublish > 250) {
      this.lastPublish = t;
      this.setStatus({
        handPresent: hit,
        ...tracking,
        fps: this.frameTimes.length,
        renderFps: this.renderTimes.length,
        inferenceMs: Math.round(this.inferEma * 10) / 10,
        inferenceP95Ms: Math.round([...this.inferenceSamples].sort((a, b) => a.ms - b.ms)[Math.max(0, Math.ceil(this.inferenceSamples.length * 0.95) - 1)].ms * 10) / 10,
        processingMs: Math.round(this.processingEma * 10) / 10,
        detectionRate: Math.round(rate * 100) / 100,
        lighting,
      });
    }
  }

  private setStatus(patch: Partial<GestureStatus>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.statusListeners.forEach(l => l());
  }
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

function cameraMessage(s: GestureStatus['camera']): string {
  switch (s) {
    case 'denied':
      return 'Camera blocked. Allow it in the address bar, or use mouse or keyboard.';
    case 'missing':
      return 'No camera found. Use mouse or keyboard.';
    case 'busy':
      return 'Another app is using the camera. Close it and try again.';
    default:
      return 'Camera unavailable here. It needs HTTPS or localhost.';
  }
}

export const gestures = new GestureController();
if (import.meta.hot) import.meta.hot.dispose(() => gestures.dispose());
