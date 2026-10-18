// The impure side: camera, MediaPipe, clock, hit-testing, DOM cursor. Wires everything to the pure engine.

import { gestureBus, makeEvent } from './bus';
import { startCamera, stopCamera } from './camera';
import { config, type Config } from './config';
import { initialState, interactionActive, step, type EngineOutput } from './engine';
import { extract } from './features';
import { BimanualCoordinator, type PairInput } from './bimanual';
import { HAND_IDS, HandTracks } from './tracks';
import { activateTarget, dropTargetAt, markPressed, objectAt, scrollTargetAt, targetAt } from './hitTest';
import { allCurled, PoseDetector } from './pose';
import { PointerMapper } from './mapping';
import { CursorPresentation } from './presentation';
import { createRecognizer, type HandTracker } from './recognizer';
import type { FixtureFrame } from './replay';
import type { Features, FrameInput, FrameObservation, GestureSource, GestureStatus, HandId, Intent, Vec2 } from './types';

const newLane = (publishDebug = false) => ({
  engine: initialState(), mapper: new PointerMapper(), poses: new PoseDetector(publishDebug),
  grabTarget: null as string | null, presentation: new CursorPresentation(),
  cursorEl: null as HTMLElement | null, chipEl: null as HTMLElement | null, chipUntil: 0,
  renderOut: null as EngineOutput | null, cursor: null as Vec2 | null,
  seen: -Infinity, present: false, reserved: false, source: 'hand' as GestureSource,
});
type Lane = ReturnType<typeof newLane>;

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
  private lanes = { left: newLane(), right: newLane(true) };
  private tracks = new HandTracks();
  private bimanual = new BimanualCoordinator();
  private generation = 0;
  private starting = false;
  private startAbort: AbortController | null = null;
  private cancelScheduled: (() => void) | null = null;
  private running = false;
  private busy = false;
  private lastVideoTime = -1;
  private debugDrawer: ((d: DebugInfo) => void) | null = null;
  private recording: FixtureFrame[] | null = null;
  private recordingSettings: Config | null = null;
  private lastCursor: { x: number; y: number } | null = null;
  private renderTicket: number | null = null;
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
  private frameListeners = new Set<(sample: FrameObservation) => void>();
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
  setCursorElement(el: HTMLElement | null, chip: HTMLElement | null, hand: HandId = 'right') {
    this.lanes[hand].cursorEl = el;
    this.lanes[hand].chipEl = chip;
  }
  setDebugDrawer(fn: ((d: DebugInfo) => void) | null) {
    this.debugDrawer = fn;
  }
  subscribe = (fn: () => void) => {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  };
  getStatus = () => this.snapshot;
  subscribeFrames = (fn: (sample: FrameObservation) => void) => {
    this.frameListeners.add(fn);
    return () => { this.frameListeners.delete(fn); };
  };
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
    this.cancelInteraction();
    this.running = false;
    this.resumeOnVisible = resumeLater;
    if (this.video) stopCamera(this.video);
    this.tracks.reset();
    for (const id of HAND_IDS) {
      const lane = this.lanes[id];
      lane.engine = initialState(); lane.mapper.reset(); lane.presentation.reset();
      lane.renderOut = null; lane.cursor = null; lane.seen = -Infinity; lane.reserved = false;
      this.renderCursor(lane, null, null);
    }
    this.setStatus({ camera: 'off', handPresent: false, detectedHands: 0, hands: undefined, trackingState: 'no_hand', fps: 0, renderFps: 0 });
  }

  cancelInteraction(emit = true) {
    for (const id of HAND_IDS) this.cancelLane(id, emit);
    for (const event of this.bimanual.reset()) {
      const { type, ...data } = event;
      gestureBus.emit(makeEvent(type, this.lanes.left.source, data));
    }
  }

  private cancelLane(id: HandId, emit = true) {
    const lane = this.lanes[id];
    if (interactionActive(lane.engine)) {
      const data = { target_id: lane.engine.pinchTarget, hand_id: id };
      if (data.target_id) gestureBus.emit(makeEvent('pointer_up', lane.source, data));
      if (emit) gestureBus.emit(makeEvent('cancel', lane.source, data));
    }
    markPressed(lane.grabTarget, false, `fist:${id}`);
    lane.grabTarget = null; lane.poses.reset();
    lane.engine = { ...initialState(), blockedUntilOpen: true };
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
  processFrame(frame: FrameInput, inferMs = 0, processingMs = inferMs, source: GestureSource = 'hand') {
    const { t, hands } = frame;
    const generation = this.generation;
    this.lastResultAt = performance.now();
    const slots = this.tracks.update(frame, config.hands);
    const pairInput: PairInput = { left: null, right: null };
    const samples = HAND_IDS.map(id => {
      const lane = this.lanes[id], slot = slots[id];
      lane.present = !!slot.hand;
      lane.source = source;
      const f = slot.hand ? extract(slot.hand, frame.videoW, frame.videoH) : null;
      let cursor: Vec2 | null = null;
      if (f) {
        if (t - lane.seen > config.hands.handLostMs) {
          this.cancelLane(id); lane.mapper.reset(); lane.presentation.reset();
        }
        lane.seen = t;
        const releasing = ['pinchPending', 'dragging'].includes(lane.engine.mode) && f.pinchRatio >= config.pinch.off;
        cursor = lane.mapper.update(f, t, innerWidth, innerHeight, config, releasing);
        if (this.running && this.renderTicket !== null) {
          lane.presentation.update(cursor, performance.now(), config.presentation.responseMs);
          cursor = lane.presentation.sample(performance.now(), config.presentation.responseMs) ?? cursor;
        }
        pairInput[id] = {
          point: { x: cursor.x / innerWidth, y: cursor.y / innerHeight }, ratio: f.pinchRatio,
          eligible: (f.threeFingerPinchRatio > config.swipe.on || f.middleExtension > config.swipe.maxMiddleExtension)
            && !allCurled(slot.hand!.landmarks),
          identified: slot.identified, target: objectAt(cursor.x, cursor.y),
        };
      }
      const target = cursor ? targetAt(cursor.x, cursor.y) : null;
      return { id, lane, slot, f, cursor, target };
    });
    const pair = this.bimanual.update(t, pairInput, config);
    for (const event of pair.events) {
      const { type, ...data } = event;
      gestureBus.emit(makeEvent(type, source, data));
      if (generation !== this.generation) return;
    }
    for (const { id, lane, slot, f, cursor, target } of samples) {
      const reserved = pair.reserved.has(id);
      if (reserved && !lane.reserved) this.cancelLane(id);
      lane.reserved = reserved;
      const input = { t, hand: f, hoveredId: target?.id ?? null, draggable: target?.draggable ?? false,
        swipeTargetId: target?.cardId ?? null,
        scrollTargetId: cursor ? scrollTargetAt(cursor.x, cursor.y) : null,
        pointer: cursor ? { x: cursor.x / innerWidth, y: cursor.y / innerHeight } : undefined,
        dropTargetId: cursor ? dropTargetAt(cursor.x, cursor.y, lane.engine.pinchTarget) : null,
      };
      if (this.recording && id === (slots.right.hand ? 'right' : 'left')) this.recording.push({
        t: Math.round(t),
        hands: hands.map(h => ({ landmarks: h.landmarks.map(p => [r4(p.x), r4(p.y), r4(p.z)]), handedness: h.handedness, handednessScore: h.handednessScore })),
        hit: { targetId: input.hoveredId, draggable: input.draggable, swipeTargetId: input.swipeTargetId,
          dropTargetId: input.dropTargetId, scrollTargetId: input.scrollTargetId },
        timing: { inferenceMs: r4(inferMs), processingMs: r4(processingMs) },
      });
      const emitNamed = (type: 'reveal' | 'dismiss' | 'scroll', delta_y?: number) => gestureBus.emit(makeEvent(type, source, {
        hand_id: id, target_id: type === 'scroll' ? lane.engine.swipeScrollTarget ?? input.scrollTargetId : lane.engine.swipeTarget ?? input.swipeTargetId,
        delta_y, x: input.pointer?.x, y: input.pointer?.y,
      }));
      const waitingForOpen = !!f && lane.engine.blockedUntilOpen && f.pinchRatio < config.pinch.off;
      if (slot.hand && f && !reserved && !waitingForOpen) {
        const named = lane.poses.update(slot.hand.landmarks, t, config.mapping.mirror,
          { width: frame.videoW, height: frame.videoH }, !input.draggable && !lane.engine.pressDraggable);
        if (named === 'swipe-left') emitNamed('reveal');
        if (named === 'swipe-right') emitNamed('dismiss');
        if (named === 'swipe-up' || named === 'swipe-down') emitNamed('scroll', named === 'swipe-up' ? 0.12 : -0.12);
        if (named === 'grab' && input.hoveredId) {
          lane.grabTarget = input.hoveredId; markPressed(lane.grabTarget, true, `fist:${id}`);
          gestureBus.emit(makeEvent('grab', source, { hand_id: id, target_id: lane.grabTarget, x: input.pointer?.x, y: input.pointer?.y }));
        }
        if (named === 'release') {
          const grabbed = lane.grabTarget;
          markPressed(grabbed, false, `fist:${id}`); lane.grabTarget = null;
          if (grabbed) activateTarget(grabbed);
          if (generation !== this.generation) return;
          gestureBus.emit(makeEvent('release', source, { hand_id: id, target_id: grabbed, x: input.pointer?.x, y: input.pointer?.y }));
        }
      } else if (!f || reserved || waitingForOpen) {
        // A lost hand never confirms its captured fist on reappearance.
        markPressed(lane.grabTarget, false, `fist:${id}`); lane.grabTarget = null; lane.poses.reset();
      }
      if (generation !== this.generation) return;
      const out = reserved ? {
        state: { ...lane.engine, mode: 'tracking' as const, pinched: this.bimanual.isPinched(id), hoverId: input.hoveredId },
        intents: [], cursorVisible: !!cursor, swipe: null,
      } : step(lane.engine, input, config);
      // The normal engine stays blocked during an object hold, then waits for opening.
      if (!reserved) lane.engine = out.state;
      if (cursor) { lane.cursor = cursor; this.lastCursor = cursor; }
      for (const intent of out.intents) {
        if (intent.type === 'drag_move' && this.running && this.renderTicket !== null) continue;
        if (intent.type === 'reveal' || intent.type === 'dismiss' || intent.type === 'scroll') continue;
        const pos = cursor ?? lane.cursor ?? { x: innerWidth / 2, y: innerHeight / 2 };
        gestureBus.emit(makeEvent(intent.type, source, {
          hand_id: id, x: pos.x / innerWidth, y: pos.y / innerHeight, confidence: f ? 1 : 0,
          target_id: 'target_id' in intent ? intent.target_id : undefined,
          drop_target_id: 'drop_target_id' in intent ? intent.drop_target_id : undefined,
          start_x: 'start_x' in intent ? intent.start_x : undefined,
          start_y: 'start_y' in intent ? intent.start_y : undefined,
        }));
        if (generation !== this.generation) return;
        if (CHIP[intent.type]) this.showChip(lane, CHIP[intent.type]!, t);
      }
      lane.renderOut = out;
      if (!this.running || this.renderTicket === null) this.renderCursor(lane, out.cursorVisible && cursor ? cursor : null, out);
      if (slot.hand) this.debugDrawer?.({ frame, primary: slot.hand, features: f, out, cursor });
    }
    this.trackMetrics(t, inferMs, processingMs, samples.some(s => !!s.f), {
      detectedHands: hands.length, trackingState: samples.some(s => !!s.f) ? 'tracking' : hands.length ? 'too_small' : 'no_hand',
      hands: Object.fromEntries(HAND_IDS.map(id => [id, { present: !!slots[id].hand, identified: slots[id].identified,
        pinched: this.bimanual.isPinched(id) || this.lanes[id].engine.pinched }])) as NonNullable<GestureStatus['hands']>,
    });
    if (this.frameListeners.size) {
      const sample: FrameObservation = { t, receivedAt: performance.now(), source, inferenceMs: inferMs, processingMs,
        hands: Object.fromEntries(samples.map(({ id, slot, f, cursor, lane }) => [id, {
          present: !!slot.hand, identified: slot.identified, pinched: this.bimanual.isPinched(id) || lane.engine.pinched,
          pointer: cursor ? { x: cursor.x / innerWidth, y: cursor.y / innerHeight } : null,
          pinchRatio: f?.pinchRatio ?? null, threeFingerPinchRatio: f?.threeFingerPinchRatio ?? null, mode: lane.reserved ? 'object grip' : lane.engine.mode,
        }])) as FrameObservation['hands'] };
      this.frameListeners.forEach(fn => { try { fn(sample); } catch (error) { console.error('[gestures] diagnostic listener failed', error); } });
    }
  }

  // ---------- rendering (direct DOM writes, never React state) ----------
  private startPresentation() {
    if (typeof requestAnimationFrame !== 'function' || this.renderTicket !== null) return;
    const paint = (now: number) => {
      if (!this.running) { this.renderTicket = null; return; }
      this.renderTimes.push(now);
      while (this.renderTimes.length && now - this.renderTimes[0] > 1000) this.renderTimes.shift();
      const stale = now - this.lastResultAt > config.perf.maxResultAgeMs;
      if (stale) this.cancelInteraction();
      for (const id of HAND_IDS) {
        const lane = this.lanes[id];
        const pos = lane.presentation.sample(now, config.presentation.responseMs);
        if (!stale && lane.present && lane.renderOut?.cursorVisible && pos && now - lane.seen <= config.perf.maxResultAgeMs) {
          lane.cursor = pos; this.lastCursor = pos;
          this.renderCursor(lane, pos, lane.renderOut, now);
          if (!lane.reserved && lane.engine.mode === 'dragging' && lane.engine.releaseSince === null) {
            gestureBus.emit(makeEvent('drag_move', lane.source, { hand_id: id, target_id: lane.engine.pinchTarget,
              x: pos.x / innerWidth, y: pos.y / innerHeight, start_x: lane.engine.pressPointer!.x, start_y: lane.engine.pressPointer!.y }));
          }
        } else this.renderCursor(lane, null, null, now);
      }
      this.renderTicket = requestAnimationFrame(paint);
    };
    this.renderTicket = requestAnimationFrame(paint);
  }
  private renderCursor(lane: Lane, pos: Vec2 | null, out: EngineOutput | null, t = performance.now()) {
    const el = lane.cursorEl;
    if (!el) return;
    if (!pos || !out) { el.style.opacity = '0'; return; }
    el.style.opacity = '1';
    el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    el.dataset.mode = out.state.mode;
    el.dataset.pinched = out.state.pinched ? 'true' : 'false';
    el.dataset.hover = out.state.hoverId ? 'true' : 'false';
    el.style.setProperty('--hold', String(out.swipe?.progress ?? 0));
    if (out.swipe) this.showChip(lane, out.swipe.label, t, 120);
    if (lane.chipEl && t > lane.chipUntil) lane.chipEl.textContent = '';
  }
  private showChip(lane: Lane, text: string, t: number, ms = 800) {
    if (!lane.chipEl) return;
    lane.chipEl.textContent = text; lane.chipUntil = t + ms;
  }

  // ---------- metrics and status ----------
  private trackMetrics(t: number, inferMs: number, processingMs: number, hit: boolean, tracking: Pick<GestureStatus, 'detectedHands' | 'trackingState' | 'hands'>) {
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
