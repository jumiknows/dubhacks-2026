"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildPlaceContext, changeSummary, distanceKm, formatKm, formatPacific, formatUtc,
  type Place, type PlaceContext, type SnapshotResponse, type ThermalObservation,
} from "@emberready/domain";
import { ObservationMap } from "./map/observation-map";
import { VoicePanel } from "./voice/voice-panel";

interface DemoProps {
  places: Place[];
  snapshotId: string;
  asOf: string;
  windowStart: string;
  fetchedAt: string;
  observations: ThermalObservation[];
  initialContext: PlaceContext;
}
const BAND_LABEL = { review: "Review", monitor: "Monitor", "no-signal": "No signal", unknown: "Unknown" };

export function Workspace({ demo }: { demo: DemoProps }) {
  const [placeId, setPlaceId] = useState(demo.places[0]?.id ?? "");
  const [asOf, setAsOf] = useState(demo.asOf);
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
  const summary = changeSummary(demo.observations, times[Math.max(0, timeIndex - 1)] ?? demo.windowStart, asOf);
  const nearby = useMemo(() => visible.map((observation) => ({ observation, kilometers: distanceKm(place.latitude, place.longitude, observation.latitude, observation.longitude) })).sort((a, b) => a.kilometers - b.kilometers), [place, visible]);
  const listed = showAll ? nearby : nearby.filter((item) => item.kilometers <= 25);
  const selected = visible.find((row) => row.id === selectedId);
  useEffect(() => () => liveRequest.current?.abort(), []);

  function replay() {
    liveRequest.current?.abort();
    setMode("replay"); setLiveMessage(null); setSelectedId(null);
  }
  async function tryLive() {
    liveRequest.current?.abort();
    const controller = new AbortController(); liveRequest.current = controller;
    setMode("live"); setLive(null); setSelectedId(null); setLiveMessage("Loading live observations.");
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
    catch { setCopyMessage("Copy is unavailable. Select the readable briefing or use Print briefing."); }
  }
  return <div className="workspace">
    <section className="communities" aria-labelledby="community-heading">
      <h2 id="community-heading">Communities</h2>
      <p className="subtle">Representative Census coordinates. Not households or boundaries.</p>
      <div className="community-buttons">{demo.places.map((item) => <button key={item.id} type="button" className="place" aria-pressed={item.id === place.id} onClick={() => { setPlaceId(item.id); setSelectedId(null); setCopyMessage(""); }}><span className="place-name">{item.name}</span><span className="place-meta">{item.censusName}</span></button>)}</div>
    </section>
    <section className="map-area" aria-labelledby="map-heading">
      <div className="map-head"><div><h2 id="map-heading">{place.name}</h2><small>{mode === "replay" ? "Replay" : "Live"}{cutoff ? ` cutoff ${formatUtc(cutoff)}. Retrieved ${formatUtc(source?.fetchedAt ?? "unknown")}.` : " observations unavailable."}</small></div>
        <div className="mode-switch"><button type="button" aria-pressed={mode === "replay"} onClick={replay}>Replay</button><button type="button" aria-pressed={mode === "live"} onClick={tryLive}>Live</button></div></div>
      {liveMessage ? <p className="status-line" role="status">{liveMessage}</p> : null}
      <div className="map-wrap"><ObservationMap observations={visible} place={place} selectedId={selectedId} onSelect={setSelectedId} /></div>
      <div className="map-foot"><span><i className="obs-key high" /> High confidence</span><span><i className="obs-key nominal" /> Nominal confidence</span><span><i className="obs-key low" /> Low confidence, not used for the band</span><span><i className="sel-key" /> Selected community</span></div>
      {mode === "replay" ? <div className="timeline"><label htmlFor="cutoff">Observation cutoff</label><input id="cutoff" type="range" min={0} max={Math.max(0, times.length - 1)} value={timeIndex} onChange={(event) => { const next = times[Number(event.target.value)]; if (next) { setAsOf(next); setSelectedId(null); } }} /><p>{formatUtc(asOf)} ({formatPacific(asOf)}). {summary.count} observations acquired since the previous cutoff. These are observations, not newly ignited fires.</p></div> : null}
    </section>
    <aside className="evidence-panel" aria-labelledby="briefing-heading">
      <h2 id="briefing-heading">{place.name}</h2>
      {context ? <><p className="band" data-band={context.attentionBand}>{BAND_LABEL[context.attentionBand]}</p><p className="briefing">{context.briefingText}</p><p className="subtle">{context.countLast24h} qualifying observations across the Washington snapshot in 24 hours. Nearest {context.nearestObservationKm === null ? "none" : formatKm(context.nearestObservationKm)}.</p></> : <p className="briefing">A live briefing is unavailable until a live source snapshot loads. No replay observations are shown in Live mode.</p>}
      <VoicePanel key={context?.contextVersion ?? `${place.id}|${mode}|unavailable`} context={context} />
      <div className="actions"><button type="button" disabled={!context} onClick={copyBriefing}>Copy briefing</button><button type="button" disabled={!context} onClick={() => window.print()}>Print briefing</button></div>
      <p role="status">{copyMessage}</p>
      <h3>Official information</h3><p className="subtle">Current resources. These pages are separate from the observation-time replay.</p><ul>{place.officialInfoLinks.map((link) => <li key={link.url}><a href={link.url}>{link.label}</a></li>)}</ul>
      <details><summary>Source evidence</summary>{context ? <><p>Snapshot <code>{context.snapshotId}</code></p><p>{source?.provider}, {source?.product}. Coverage {source?.coverageStatus}. Retrieval {source?.fetchedAt}. Latest acquisition {source?.newestObservationAt ?? "none"}.</p><a href={`/api/snapshots/${context.snapshotId}/provenance`}>Open provenance and quality report</a></> : <p>No source snapshot loaded.</p>}</details>
      <div className="list-head"><h3 id="observation-list" tabIndex={-1}>Observations</h3><button type="button" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? "Nearby only" : "All in snapshot"}</button></div>
      <p className="subtle">{listed.length} shown of {visible.length} at or before the cutoff. The list works when the map does not.</p>
      {selected ? <div className="observation-detail" aria-live="polite"><h4>Selected observation</h4><p>{selected.confidence} confidence, acquired {formatUtc(selected.observedAt)}. {selected.latitude}, {selected.longitude}. {selected.satellite}, {selected.product}. FRP {selected.frpMw ?? "missing"}{selected.frpMw === null ? "" : " MW"}. FRP is not fire size.</p><p>Source row <code>{selected.rawRowId}</code></p></div> : null}
      {listed.length === 0 ? <p>No observations match this view. This does not establish safety or complete satellite coverage.</p> : null}
      <ul className="observation-list">{listed.map(({ observation, kilometers }) => <li key={observation.id}><button type="button" aria-pressed={observation.id === selectedId} onClick={() => setSelectedId(observation.id)}><span>{observation.confidence} · {formatKm(kilometers)}</span><span>{formatUtc(observation.observedAt)}</span><span>FRP {observation.frpMw === null ? "missing" : `${observation.frpMw} MW`}</span></button></li>)}</ul>
    </aside>
  </div>;
}
