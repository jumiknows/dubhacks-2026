// Pure press/drag/swipe rules. Browser work stays in loop.ts and hitTest.ts.
import type { Config } from './config';
import type { Features, Intent, Vec2 } from './types';

export type Mode = 'idle' | 'tracking' | 'pinchPending' | 'dragging' | 'swiping';
export type EngineState = {
  mode: Mode;
  presentSince: number | null;
  lastSeen: number | null;
  pinched: boolean;
  pinchTarget: string | null;
  pressPalm: Vec2 | null;
  pressPointer: Vec2 | null;
  pressStarted: number;
  pressDraggable: boolean;
  pressMoved: boolean;
  clickAllowed: boolean;
  pressConfirmed: boolean;
  releaseSince: number | null;
  swipeCandidateSince: number | null;
  swipeStart: Vec2 | null;
  swipeTarget: string | null;
  swipeFired: boolean;
  swipeAxis: 'horizontal' | 'vertical' | null;
  swipeScrollTarget: string | null;
  swipeLastY: number;
  blockedUntilOpen: boolean;
  cooldownUntil: number;
  hoverId: string | null;
  hoverNullSince: number | null;
};
export const initialState = (): EngineState => ({
  mode: 'idle', presentSince: null, lastSeen: null, pinched: false,
  pinchTarget: null, pressPalm: null, pressPointer: null, pressStarted: 0,
  pressDraggable: false, pressMoved: false, clickAllowed: false,
  pressConfirmed: false,
  releaseSince: null, swipeCandidateSince: null, swipeStart: null, swipeTarget: null,
  swipeFired: false, blockedUntilOpen: false, cooldownUntil: 0,
  swipeAxis: null, swipeScrollTarget: null, swipeLastY: 0,
  hoverId: null, hoverNullSince: null,
});
export type EngineInput = {
  t: number;
  hand: Features | null;
  hoveredId: string | null;
  pointer?: Vec2; // normalized viewport coordinates, for drag origins
  draggable?: boolean;
  dropTargetId?: string | null;
  swipeTargetId?: string | null; // card containing a nested control
  scrollTargetId?: string | null; // scroll container under the pointer when the pinch starts
};
export type EngineOutput = {
  state: EngineState;
  intents: Intent[];
  cursorVisible: boolean;
  swipe: { label: string; progress: number } | null;
};
export const interactionActive = (s: EngineState) => ['pinchPending', 'dragging', 'swiping'].includes(s.mode);

export function step(prev: EngineState, input: EngineInput, c: Config): EngineOutput {
  const s = { ...prev };
  const intents: Intent[] = [];
  const { t, hand } = input;
  const done = (visible = true, swipe: EngineOutput['swipe'] = null): EngineOutput =>
    ({ state: s, intents, cursorVisible: visible, swipe });
  const finish = () => {
    const wasSwipe = s.mode === 'swiping';
    s.mode = 'tracking';
    s.pinchTarget = null;
    s.pressPalm = s.pressPointer = s.swipeStart = null;
    s.swipeTarget = null;
    s.swipeAxis = null;
    s.swipeScrollTarget = null;
    s.releaseSince = s.swipeCandidateSince = null;
    s.pinched = false;
    // Count swipe cooldown from its action, rather than adding another pause after full release.
    s.cooldownUntil = wasSwipe ? Math.max(t, s.cooldownUntil) : t;
  };
  const up = () => {
    if (s.pinchTarget) intents.push({ type: 'pointer_up', target_id: s.pinchTarget });
  };
  const drag = (type: 'drag_start' | 'drag_move') => intents.push({
    type, target_id: s.pinchTarget!,
    start_x: s.pressPointer!.x, start_y: s.pressPointer!.y,
  });

  if (!hand || hand.palmCenter.y >= c.mapping.idleBelowY) {
    const lost = s.lastSeen === null ? Infinity : t - s.lastSeen;
    if (s.mode === 'idle') s.presentSince = null;
    if (lost >= c.hands.handLostMs) {
      if (interactionActive(s)) {
        up();
        intents.push({ type: 'cancel', target_id: s.pinchTarget });
      }
      if (s.hoverId !== null) intents.push({ type: 'hover', target_id: null });
      return { state: { ...initialState(), blockedUntilOpen: s.blockedUntilOpen || interactionActive(s) }, intents, cursorVisible: false, swipe: null };
    }
    return done(s.mode !== 'idle');
  }

  s.lastSeen = t;
  if (s.presentSince === null) s.presentSince = t;
  if (s.mode === 'idle') {
    if (t - s.presentSince < c.hands.enterMs) return done(false);
    s.mode = 'tracking';
  }

  const pinched = hand.pinchRatio < (s.pinched ? c.pinch.off : c.pinch.on);
  const candidate = hand.threeFingerPinchRatio < c.swipe.on && hand.middleExtension < c.swipe.maxMiddleExtension;
  if (s.blockedUntilOpen) {
    if (pinched || candidate) return done();
    s.blockedUntilOpen = false;
    s.pinched = false;
  }

  // An armed swipe tolerates transient landmark errors. It fires once at sufficient travel.
  const advanceSwipe = () => {
    const held = hand.threeFingerPinchRatio < c.swipe.off;
    if (!held) {
      if (s.releaseSince === null) s.releaseSince = t;
      if (t - s.releaseSince >= c.swipe.releaseMs) {
        s.blockedUntilOpen = pinched || candidate;
        finish();
        return done();
      }
    } else {
      s.releaseSince = null;
      const dx = hand.palmCenter.x - s.swipeStart!.x;
      const dy = hand.palmCenter.y - s.swipeStart!.y;
      const horizontal = Math.abs(dx) >= c.swipe.minDist && Math.abs(dx) > c.swipe.dominance * Math.abs(dy);
      const vertical = Math.abs(dy) >= c.swipe.minDist && Math.abs(dy) > c.swipe.dominance * Math.abs(dx);
      // Lock the first deliberate axis until release. Scrolling cannot dismiss a card.
      if (s.swipeAxis === null) {
        if (horizontal) s.swipeAxis = 'horizontal';
        else if (vertical) s.swipeAxis = 'vertical';
        if (s.swipeAxis) s.cooldownUntil = t + c.cooldownMs;
      }
      const screenDx = c.mapping.mirror ? -dx : dx;
      if (s.swipeAxis === 'horizontal' && !s.swipeFired) {
        if (screenDx < 0) intents.push({ type: 'reveal' });
        else if (s.swipeTarget) intents.push({ type: 'dismiss', target_id: s.swipeTarget });
        s.swipeFired = true;
      }
      if (s.swipeAxis === 'vertical') {
        const delta = hand.palmCenter.y - s.swipeLastY;
        // Accumulate sub-deadband motion, suppressing stationary landmark jitter.
        if (Math.abs(delta) >= c.scroll.deadband) {
          intents.push({ type: 'scroll', target_id: s.swipeScrollTarget, delta_y: -delta * c.scroll.gain });
          s.swipeLastY = hand.palmCenter.y;
        }
      }
      return done(true, {
        label: s.swipeAxis === 'vertical' ? 'Scrolling: move up or down' : s.swipeFired ? 'Release to reset' : 'Three fingers: move left, right, up or down',
        progress: Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / c.swipe.minDist),
      });
    }
    return done(true, { label: 'Release to reset', progress: s.swipeFired ? 1 : 0 });
  };
  if (s.mode === 'swiping') return advanceSwipe();

  // Classify three fingers before deciding to start a drag; never change a live drag into a swipe.
  if (candidate && s.mode !== 'dragging') {
    if (s.swipeCandidateSince === null) s.swipeCandidateSince = t;
  } else {
    s.swipeCandidateSince = null;
  }
  if (s.swipeCandidateSince !== null && t - s.swipeCandidateSince >= c.swipe.armMs && t >= s.cooldownUntil) {
    up();
    s.swipeStart = s.pressPalm ?? { ...hand.palmCenter };
    s.swipeTarget = s.mode === 'pinchPending' ? s.swipeTarget : (input.swipeTargetId ?? s.hoverId);
    s.mode = 'swiping';
    s.pinchTarget = null;
    s.pinched = true;
    s.releaseSince = null;
    s.swipeFired = false;
    s.swipeAxis = null;
    s.swipeLastY = s.swipeStart.y;
    // Resolve sufficient motion on the arming frame itself; an extra frame lost fast swipes at 15fps.
    return advanceSwipe();
  }

  if (s.mode === 'pinchPending' || s.mode === 'dragging') {
    if (!pinched && !candidate) {
      if (s.releaseSince === null) s.releaseSince = t;
      if (t - s.releaseSince < c.pinch.releaseMs) return done();
      up();
      if (s.mode === 'dragging' && s.pinchTarget) {
        intents.push({ type: 'drop', target_id: s.pinchTarget,
          drop_target_id: input.dropTargetId && input.dropTargetId !== s.pinchTarget ? input.dropTargetId : null });
      } else if (s.clickAllowed && s.pressConfirmed && !s.pressMoved && s.pinchTarget) {
        intents.push({ type: 'select', target_id: s.pinchTarget });
      }
      finish();
      return done();
    }
    s.releaseSince = null;
    if (pinched && t - s.pressStarted >= c.pinch.confirmMs) s.pressConfirmed = true;
    const moved = Math.hypot(hand.palmCenter.x - s.pressPalm!.x, hand.palmCenter.y - s.pressPalm!.y) >= c.drag.minDist;
    s.pressMoved ||= moved;
    if (s.mode === 'pinchPending' && moved && s.pressDraggable && !candidate && t - s.pressStarted >= c.drag.armMs) {
      s.mode = 'dragging';
      drag('drag_start');
    }
    if (s.mode === 'dragging') drag('drag_move');
    return done();
  }

  // Hover tracks the actual component; its visual stickiness does not make empty space clickable.
  const target = input.hoveredId;
  if (target !== null) {
    s.hoverNullSince = null;
    if (target !== s.hoverId) {
      s.hoverId = target;
      intents.push({ type: 'hover', target_id: target });
    }
  } else if (s.hoverId !== null) {
    if (s.hoverNullSince === null) s.hoverNullSince = t;
    if (t - s.hoverNullSince >= c.hover.stickyMs) {
      s.hoverId = null;
      s.hoverNullSince = null;
      intents.push({ type: 'hover', target_id: null });
    }
  }
  // Capture a new press origin immediately, even if swipe arming still awaits its cooldown.
  if ((pinched || candidate) && !s.pinched) {
    s.mode = 'pinchPending';
    s.pinchTarget = target;
    s.pressPalm = { ...hand.palmCenter };
    s.pressPointer = { ...(input.pointer ?? hand.palmCenter) };
    s.swipeTarget = input.swipeTargetId === undefined ? target : input.swipeTargetId;
    s.swipeScrollTarget = input.scrollTargetId ?? null;
    s.pressStarted = t;
    s.pressDraggable = !!target && (input.draggable ?? true);
    s.pressMoved = false;
    s.clickAllowed = pinched && !candidate;
    s.pressConfirmed = c.pinch.confirmMs <= 0;
    s.releaseSince = null;
    if (target) intents.push({ type: 'pointer_down', target_id: target });
  }
  s.pinched = pinched;
  return done();
}
