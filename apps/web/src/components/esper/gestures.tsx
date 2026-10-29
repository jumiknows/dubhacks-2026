"use client";
import { GestureProvider, Hints, useGestureStatus } from "conjure-gestures";
import { useState, type ReactNode } from "react";

export function AppGestures({ children }: { children: ReactNode }) {
  return <GestureProvider poseDebug={false}>{children}</GestureProvider>;
}
export function HandsButton() {
  const { camera, start, stop, error } = useGestureStatus();
  const [hints, setHints] = useState(false);
  return <><button type="button" className="btn esper-hands" disabled={camera === "starting"} aria-pressed={camera === "on"} title={error || undefined} onClick={() => { if (camera === "on") stop(); else { setHints(true); void start(); } }}>{camera === "on" ? "Stop hands" : camera === "starting" ? "Starting camera…" : "Use hands"}</button>{hints ? <Hints onDone={() => setHints(false)} /> : null}</>;
}
export function AppLinks() {
  return <nav className="esper-app-links" aria-label="Applications"><a href="/">Trip planner</a><a href="/fires">Fire map</a><a href="/gesture-lab">Gesture lab</a><HandsButton /></nav>;
}
