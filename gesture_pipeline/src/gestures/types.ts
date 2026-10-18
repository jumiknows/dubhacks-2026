// App-owned types. MediaPipe types stay in recognizer.ts.
export type Pt = { x: number; y: number; z: number };
export type Vec2 = { x: number; y: number };
export type HandFrame = { landmarks: Pt[]; handedness?: string };
export type FrameInput = { t: number; hands: HandFrame[]; videoW: number; videoH: number };

export type Features = {
  palmSize: number; // pixels, wrist to middle knuckle
  pinchRatio: number; // thumb-index distance / palm size
  threeFingerPinchRatio: number; // largest thumb-to-index/middle distance / palm size
  middleExtension: number; // middle tip-to-wrist / middle joint-to-wrist; distinguishes a bent middle finger
  palmCenter: Vec2;
  indexTip: Vec2;
  thumbTip: Vec2;
  bboxArea: number; // normalized area, useful for debugging hand filters
};

export type GestureType = 'hover' | 'pointer_down' | 'pointer_up' | 'select' | 'drag_start' | 'drag_move' | 'drop' | 'reveal' | 'dismiss' | 'scroll' | 'cancel';
export type GestureSource = 'hand' | 'mouse' | 'keyboard' | 'voice';
export type GestureEvent = {
  type: GestureType;
  target_id?: string | null;
  drop_target_id?: string | null;
  start_x?: number;
  start_y?: number;
  delta_y?: number; // scroll distance in viewport heights; positive scrolls toward later content
  x: number; // normalized viewport coordinates
  y: number;
  confidence: number; // hand rules report a match, not a model probability
  source: GestureSource;
  ts: number;
  event_id: string;
};
export type Intent =
  | { type: 'hover' | 'select' | 'dismiss' | 'pointer_down' | 'pointer_up' | 'cancel'; target_id: string | null }
  | { type: 'drag_start' | 'drag_move'; target_id: string; start_x: number; start_y: number }
  | { type: 'drop'; target_id: string; drop_target_id: string | null }
  | { type: 'scroll'; target_id: string | null; delta_y: number }
  | { type: 'reveal' };

export type CameraStatus = 'off' | 'starting' | 'on' | 'denied' | 'missing' | 'busy' | 'error';
export type GestureStatus = {
  camera: CameraStatus;
  delegate: 'GPU' | 'CPU' | null;
  backend: 'worker' | 'main' | null;
  handPresent: boolean;
  detectedHands: number;
  trackingState: 'no_hand' | 'too_small' | 'switching' | 'resting' | 'tracking';
  videoWidth: number;
  videoHeight: number;
  fps: number;
  renderFps: number;
  inferenceMs: number;
  inferenceP95Ms: number;
  processingMs: number; // capture/transfer/inference round trip; not physical motion-to-screen latency
  detectionRate: number;
  lighting: 'ok' | 'low';
  recording: boolean;
  error: string | null;
};
