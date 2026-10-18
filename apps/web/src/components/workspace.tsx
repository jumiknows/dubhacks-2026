"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildPlaceContext, changeSummary, distanceKm, formatKm, formatPacific, formatUtc, MONITOR_KM, REVIEW_KM,
  type AttentionBand, type Place, type PlaceContext, type SnapshotResponse, type ThermalObservation,
} from "@emberready/domain";
import { riskDateFor, type RiskDay, type RiskGrid, type RiskSummary } from "../lib/risk";
import { ObservationMap, type RiskLayer } from "./map/observation-map";
import { RiskPanel } from "./risk-panel";
import { Timeline } from "./timeline";
import { VoicePanel } from "./voice/voice-panel";

interface DemoProps {
  places: Place[];
  bbox: [number, number, number, number];
  snapshotId: string;
  asOf: string;
  windowStart: string;
  fetchedAt: string;
  observations: ThermalObservation[];
  initialContext: PlaceContext;
}

const BAND: Record<AttentionBand, { label: string; headline: string }> = {
  review: { label: "Review", headline: `Thermal activity within ${REVIEW_KM} km` },
  monitor: { label: "Monitor", headline: `Activity in the wider ${MONITOR_KM} km area` },
  "no-signal": { label: "Nothing nearby", headline: `Nothing within ${MONITOR_KM} km in the last 24 hours` },
  unknown: { label: "Unknown", headline: "Source data needs review" },
};

function ago(from: string, to: string): string {
  const hours = (Date.parse(to) - Date.parse(from)) / 3_600_000;
  if (hours < 1) return "at cutoff";
  if (hours < 48) return `${Math.round(hours)} h earlier`;
  return `${Math.round(hours / 24)} d earlier`;
}

export function Workspace({ demo }: { demo: DemoProps }) {
  const [placeId, setPlaceId] = useState(demo.places[0]?.id ?? "");
  const [asOf, setAsOfState] = useState(demo.asOf);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [live, setLive] = useState<SnapshotResponse | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const liveRequest = useRef<AbortController | null>(null);
  const place = demo.places.find((item) => item.id === placeId) ?? demo.places[0];
  const source = mode === "replay" ? demo.initialContext.sources[0] : live?.sources[0];
  const snapshotId = mode === "replay" ? demo.snapshotId : live?.snapshotId;
  const cutoff = mode === "replay" ? asOf : live?.asOf;
  const allObservations = mode === "replay" ? demo.observations : live?.observations ?? [];
  const times = useMemo(() => Array.from(new Set(demo.observations.map((row) => row.observedAt))).sort(), [demo.observations]);
  const visible = useMemo(() => cutoff ? allObservations.filter((row) => row.observedAt <= cutoff) : [], [allObservations, cutoff]);
  const context = useMemo(() => source && snapshotId && cutoff && place ? buildPlaceContext({ place, snapshotId, mode, asOf: cutoff, source, observations: allObservations }) : null, [source, snapshotId, cutoff, place, mode, allObservations]);
  const timeIndex = Math.max(0, times.indexOf(asOf));
  const fresh = useMemo(() => mode === "replay" ? changeSummary(demo.observations, times[timeIndex - 1] ?? demo.windowStart, asOf) : { count: 0, observationIds: [] }, [mode, demo.observations, demo.windowStart, times, timeIndex, asOf]);
  const freshIds = useMemo(() => new Set(fresh.observationIds), [fresh]);
  const nearby = useMemo(() => visible.map((observation) => ({ observation, kilometers: distanceKm(place.latitude, place.longitude, observation.latitude, observation.longitude) })).sort((a, b) => a.kilometers - b.kilometers), [place, visible]);
  const listed = showAll ? nearby : nearby.filter((item) => item.kilometers <= MONITOR_KM);
  const selected = nearby.find((row) => row.observation.id === selectedId);
  useEffect(() => () => liveRequest.current?.abort(), []);

  // Research danger zones: the grid and model summary once, then one ranking per day.
  const [riskMeta, setRiskMeta] = useState<{ summary: RiskSummary; grid: RiskGrid } | null>(null);
  const [riskDay, setRiskDay] = useState<RiskDay | null>(null);
  const [showRisk, setShowRisk] = useState(true);
  useEffect(() => {
    fetch("/api/risk").then((response) => response.ok ? response.json() : null).then(setRiskMeta).catch(() => setRiskMeta(null));
  }, []);
  const riskDate = useMemo(() => {
    if (!riskMeta) return null;
    if (mode === "replay") return cutoff ? riskDateFor(cutoff) : null;
    const scored = Object.values(riskMeta.summary.dates).filter((entry) => entry.status !== "unavailable").map((entry) => entry.date).sort();
    return scored.at(-1) ?? null;
  }, [riskMeta, mode, cutoff]);
  useEffect(() => {
    if (!riskDate) { setRiskDay(null); return; }
    const controller = new AbortController();
    fetch(`/api/risk/${riskDate}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (!controller.signal.aborted) setRiskDay(body); })
      .catch(() => { if (!controller.signal.aborted) setRiskDay(null); });
    return () => controller.abort();
  }, [riskDate]);
  const riskLayer = useMemo<RiskLayer | null>(() => showRisk && riskMeta && riskDay
    ? { polygons: riskMeta.grid.polygons, tier: riskDay.cells.tier, rank: riskDay.cells.rank }
    : null, [showRisk, riskMeta, riskDay]);
  const riskCell = riskMeta ? riskMeta.grid.placeCells[place.id] ?? null : null;

  useEffect(() => {
    const open = () => document.querySelector(".briefing-box")?.setAttribute("open", "");
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, []);

  const setAsOf = useCallback((next: string) => { setAsOfState(next); setSelectedId(null); }, []);
  function replay() {
    liveRequest.current?.abort();
    setMode("replay"); setLiveMessage(null); setSelectedId(null);
  }
  async function tryLive() {
    liveRequest.current?.abort();
    const controller = new AbortController(); liveRequest.current = controller;
    setMode("live"); setLive(null); setSelectedId(null); setLiveMessage("Loading live observations from NASA FIRMS.");
    try {
      const response = await fetch("/api/observations?mode=live", { signal: controller.signal });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || body.mode !== "live") { setLiveMessage(body.error?.message ?? "Live observations are unavailable."); return; }
      setLive(body); setLiveMessage(body.sources[0]?.fetchStatus === "stale" ? "The provider failed to refresh. Showing a retained live snapshot with its original retrieval time." : null);
    } catch { if (!controller.signal.aborted) setLiveMessage("Live observations could not be loaded. Try again or select Replay."); }
  }
  async function copyBriefing() {
    if (!context) return;
    try { await navigator.clipboard.writeText(context.briefingText); setCopyMessage("Briefing copied."); }
    catch { setCopyMessage("Copy is unavailable. Select the briefing text or print it."); }
  }
  const placeBands = useMemo(() => new Map(demo.places.map((item) => [item.id, source && snapshotId && cutoff ? buildPlaceContext({ place: item, snapshotId, mode, asOf: cutoff, source, observations: allObservations }).attentionBand : "unknown"])), [demo.places, source, snapshotId, cutoff, mode, allObservations]);
  const band = context ? BAND[context.attentionBand] : null;
  const within = context?.matchingObservationIds.length ?? 0;

  return <div className="app" data-mode={mode}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true" />EmberReady</div>
      <div className="sat mono" aria-label="Data source">
        <span className="sat-dot" aria-hidden="true" />NASA FIRMS · NOAA-20 VIIRS 375 m · Washington
      </div>
      <div className="mode-switch" role="group" aria-label="Data mode">
        <button type="button" aria-pressed={mode === "replay"} onClick={replay}>Replay</button>
        <button type="button" aria-pressed={mode === "live"} onClick={tryLive}><span className="live-dot" aria-hidden="true" />Live</button>
      </div>
    </header>

    <nav className="places" aria-labelledby="community-heading">
      <h2 id="community-heading" className="sr-only">Communities</h2>
      {demo.places.map((item) => <button key={item.id} type="button" className="place" aria-pressed={item.id === place.id} aria-label={`${item.name}, ${item.censusName}`} onClick={() => { setPlaceId(item.id); setSelectedId(null); setCopyMessage(""); }}><span className="band-glyph" data-band={placeBands.get(item.id)} aria-hidden="true" />{item.name}</button>)}
    </nav>

    <section className="stage" aria-labelledby="map-heading">
      <h2 id="map-heading" className="sr-only">Map near {place.name}</h2>
      <div className="map-wrap">
        <ObservationMap risk={riskLayer} observations={visible} freshIds={freshIds} asOf={cutoff} place={place} bbox={demo.bbox} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="hud mono" aria-hidden="true">
          <span>{mode === "replay" ? "REPLAY" : "LIVE"}</span>
          <span>{cutoff ? formatUtc(cutoff) : "NO DATA"}</span>
          <span>{visible.length} DETECTIONS</span>
        </div>
        <ul className="legend" aria-label="Map legend">
          <li><i className="dot high" />High</li>
          <li><i className="dot nominal" />Nominal</li>
          <li><i className="dot low" />Low, not banded</li>
          <li><i className="ring-key" />{REVIEW_KM} / {MONITOR_KM} km</li>
          {riskLayer ? <li><i className="zone-key" />Danger zones (research)</li> : null}
        </ul>
      </div>
      {liveMessage ? <p className="status-line" role="status">{liveMessage}</p> : null}
      {mode === "replay"
        ? <Timeline observations={demo.observations} times={times} windowStart={demo.windowStart} asOf={asOf} freshCount={fresh.count} onChange={setAsOf} />
        : <div className="timeline live-note"><p>Live shows the latest NASA response only. Switch to Replay to scrub through the week.</p></div>}
    </section>

    <aside className="panel" aria-labelledby="briefing-heading">
      <div className="panel-head">
        <h2 id="briefing-heading">{place.name}</h2>
        {band && context ? <p className="band" data-band={context.attentionBand}><span className="band-glyph" aria-hidden="true" />{band.label}</p> : null}
      </div>
      {context && band ? <>
        <p className="headline">{band.headline}</p>
        <dl className="stats">
          <div><dt>Nearest</dt><dd className="mono">{context.nearestObservationKm === null ? "None" : formatKm(context.nearestObservationKm)}</dd></div>
          <div><dt>Within {MONITOR_KM} km</dt><dd className="mono">{within}</dd></div>
          <div><dt>Last 24 h, WA</dt><dd className="mono">{context.countLast24h}</dd></div>
        </dl>
        <details className="briefing-box">
          <summary>Full briefing <span className="mono subtle">{formatPacific(context.asOf)}</span></summary>
          <p className="briefing">{context.briefingText}</p>
        </details>
      </> : <p className="briefing empty">A live briefing is unavailable until a live source snapshot loads. No replay observations are shown in Live mode.</p>}

      {riskMeta ? <RiskPanel summary={riskMeta.summary} date={riskDate} day={riskDay} cell={riskCell} shown={showRisk} onToggle={() => setShowRisk((value) => !value)} /> : null}

      <VoicePanel key={context?.contextVersion ?? `${place.id}|${mode}|unavailable`} context={context} />
      <div className="share">
        <button type="button" className="link-btn" disabled={!context} onClick={copyBriefing}>Copy briefing</button>
        <button type="button" className="link-btn" disabled={!context} onClick={() => window.print()}>Print briefing</button>
        <span role="status" className="subtle">{copyMessage}</span>
      </div>

      <div className="list-head">
        <h3 id="observation-list" tabIndex={-1}>Detections</h3>
        <button type="button" className="chip" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? "Nearby only" : "All in snapshot"}</button>
      </div>
      {selected ? <div className="observation-detail" aria-live="polite">
        <h4>Selected observation</h4>
        <p><b className={`conf ${selected.observation.confidence}`}>{selected.observation.confidence}</b> confidence, {formatKm(selected.kilometers)} away, acquired {formatUtc(selected.observation.observedAt)}.</p>
        <p className="mono subtle">{selected.observation.latitude}, {selected.observation.longitude} · {selected.observation.satellite} {selected.observation.product} · FRP {selected.observation.frpMw ?? "missing"}{selected.observation.frpMw === null ? "" : " MW"} (not fire size)</p>
        <p className="mono subtle">row <code>{selected.observation.rawRowId}</code></p>
      </div> : null}
      {listed.length === 0
        ? <p className="nothing">{showAll ? "No observations at or before this cutoff." : `No detections within ${MONITOR_KM} km.`} That does not establish safety or complete satellite coverage.</p>
        : <ul className="observation-list">{listed.map(({ observation, kilometers }) => <li key={observation.id}>
          <button type="button" aria-pressed={observation.id === selectedId} onClick={() => setSelectedId(observation.id)}>
            <i className={`dot ${observation.confidence}`} aria-hidden="true" />
            <span className="mono km">{formatKm(kilometers)}</span>
            <span className="when">{observation.confidence} · {cutoff ? ago(observation.observedAt, cutoff) : formatUtc(observation.observedAt)}</span>
            <span className="mono frp">{observation.frpMw === null ? "FRP –" : `${observation.frpMw} MW`}</span>
          </button>
        </li>)}</ul>}

      <footer className="fineprint">
        <p>Satellite thermal detections, not confirmed fires. Not a fire probability or evacuation guidance.</p>
        <ul>{place.officialInfoLinks.map((link) => <li key={link.url}><a href={link.url}>{link.label}</a></li>)}</ul>
        <details>
          <summary>Source evidence</summary>
          {context ? <>
            <p>{source?.provider}, {source?.product}. Coverage {source?.coverageStatus}. Retrieved {source?.fetchedAt ? formatUtc(source.fetchedAt) : "unknown"}. Latest acquisition {source?.newestObservationAt ? formatUtc(source.newestObservationAt) : "none"}.</p>
            <p>Snapshot <code>{context.snapshotId}</code></p>
            <a href={`/api/snapshots/${context.snapshotId}/provenance`}>Open provenance and quality report</a>
          </> : <p>No source snapshot loaded.</p>}
        </details>
      </footer>
    </aside>
  </div>;
}
