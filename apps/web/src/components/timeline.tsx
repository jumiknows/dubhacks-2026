"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatPacific, formatUtc, type ThermalObservation } from "@emberready/domain";

interface TimelineProps {
  observations: ThermalObservation[];
  times: string[];
  windowStart: string;
  asOf: string;
  freshCount: number;
  onChange: (time: string) => void;
}

const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", day: "numeric" });
const HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" });
const MINUTE = 60_000;

export function Timeline({ observations, times, windowStart, asOf, freshCount, onChange }: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const index = Math.max(0, times.indexOf(asOf));
  const start = Math.min(Date.parse(windowStart), Date.parse(times[0] ?? windowStart));
  const end = Date.parse(times.at(-1) ?? windowStart);
  const span = Math.max(1, end - start);
  const at = (time: string | number) => ((typeof time === "number" ? time : Date.parse(time)) - start) / span;

  const passes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of observations) counts.set(row.observedAt, (counts.get(row.observedAt) ?? 0) + 1);
    const max = Math.max(1, ...counts.values());
    return times.map((time) => {
      const hour = Number(HOUR.format(new Date(time)));
      return { time, count: counts.get(time) ?? 0, height: (counts.get(time) ?? 0) / max, night: hour < 6 || hour >= 19 };
    });
  }, [observations, times]);

  const days = useMemo(() => {
    const labels: { label: string; time: number }[] = [];
    for (let time = start; time <= end; time += 60 * MINUTE) {
      if (HOUR.format(new Date(time)) === "0" || HOUR.format(new Date(time)) === "00") labels.push({ label: DAY.format(new Date(time)), time });
    }
    return labels;
  }, [start, end]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const next = times.indexOf(asOf) + 1;
      if (next >= times.length) { setPlaying(false); return; }
      onChange(times[next]);
    }, 650);
    return () => clearInterval(timer);
  }, [playing, asOf, times, onChange]);

  function toggle() {
    if (!playing && index >= times.length - 1) onChange(times[0]);
    setPlaying((value) => !value);
  }
  function go(next: number) {
    setPlaying(false);
    const time = times[Math.min(times.length - 1, Math.max(0, next))];
    if (time) onChange(time);
  }
  function snap(minutes: number) {
    const target = start + minutes * MINUTE;
    let best = 0;
    times.forEach((time, i) => { if (Math.abs(Date.parse(time) - target) < Math.abs(Date.parse(times[best]) - target)) best = i; });
    go(best);
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    const moves: Record<string, number> = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, PageDown: index - 4, PageUp: index + 4, Home: 0, End: times.length - 1 };
    if (event.key in moves) { event.preventDefault(); go(moves[event.key]); }
  }

  const pass = passes[index];
  return <div className="timeline">
    <div className="timeline-head">
      <button type="button" className="play" aria-label={playing ? "Pause replay" : "Play replay"} onClick={toggle}>
        {playing
          ? <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" /></svg>}
      </button>
      <div className="timeline-readout">
        <label htmlFor="cutoff">Satellite pass {index + 1} of {times.length}</label>
        <strong className="mono">{formatPacific(asOf)}</strong>
        <span className="mono subtle">{formatUtc(asOf).slice(11)} · {pass?.night ? "night" : "day"} · <em>+{freshCount} new</em></span>
      </div>
    </div>
    <div className="passes">
      <div className="bars" aria-hidden="true">
        {passes.map((item, i) => <span
          key={item.time}
          className="bar"
          data-state={i === index ? "current" : i < index ? "past" : "future"}
          data-night={item.night}
          style={{ left: `${at(item.time) * 100}%`, height: `${8 + item.height * 92}%` }}
        />)}
      </div>
      <input
        id="cutoff"
        type="range"
        min={0}
        max={Math.round(span / MINUTE)}
        step={1}
        value={Math.round((Date.parse(asOf) - start) / MINUTE)}
        aria-valuetext={`${formatUtc(asOf)}, pass ${index + 1} of ${times.length}, ${freshCount} new observations`}
        onKeyDown={keys}
        onChange={(event) => snap(Number(event.target.value))}
      />
      <div className="days mono" aria-hidden="true">
        {days.map((item) => <span key={item.time} style={{ left: `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${at(item.time)})` }}>{item.label}</span>)}
      </div>
    </div>
  </div>;
}
