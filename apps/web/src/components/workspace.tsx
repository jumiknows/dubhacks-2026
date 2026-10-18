"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  changeSummary,
  distanceKm,
  formatKm,
  formatPacific,
  formatUtc,
  type Place,
  type PlaceContext,
  type ThermalObservation,
} from "@emberready/domain";
import { ObservationMap } from "./map/observation-map";

interface DemoProps {
  places: Place[];
  snapshotId: string;
  asOf: string;
  windowStart: string;
  fetchedAt: string;
  observations: ThermalObservation[];
  initialContext: PlaceContext;
}

const BAND_LABEL: Record<PlaceContext["attentionBand"], string> = {
  review: "Review",
  monitor: "Monitor",
  "no-signal": "No signal",
  unknown: "Unknown",
};

export function Workspace({ demo }: { demo: DemoProps }) {
  const [placeId, setPlaceId] = useState(demo.places[0]?.id ?? "");
  const [asOf, setAsOf] = useState(demo.asOf);
  const [context, setContext] = useState(demo.initialContext);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [voiceMessage, setVoiceMessage] = useState("Spoken briefing uses server-side Grok text to speech. No key is configured in this demo, so the readable briefing stays on screen.");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const versionRef = useRef(demo.initialContext.contextVersion);

  const place = demo.places.find((item) => item.id === placeId) ?? demo.places[0];
  const times = useMemo(
    () => Array.from(new Set(demo.observations.map((observation) => observation.observedAt))).sort(),
    [demo.observations],
  );
  const visible = useMemo(
    () => demo.observations.filter((observation) => observation.observedAt <= asOf),
    [demo.observations, asOf],
  );
  const timeIndex = Math.max(0, times.findIndex((time) => time === asOf));
  const previousAsOf = times[Math.max(0, timeIndex - 1)] ?? demo.windowStart;
  const summary = changeSummary(demo.observations, previousAsOf, asOf);

  const nearby = useMemo(() => {
    if (!place) return [];
    return visible
      .map((observation) => ({
        observation,
        kilometers: distanceKm(place.latitude, place.longitude, observation.latitude, observation.longitude),
      }))
      .sort((a, b) => a.kilometers - b.kilometers);
  }, [place, visible]);
  const listed = showAll ? nearby : nearby.filter((item) => item.kilometers <= 25);

  useEffect(() => {
    versionRef.current = context.contextVersion;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
  }, [context.contextVersion]);

  useEffect(() => {
    if (mode !== "replay" || !place) return;
    const active = `${place.id}|${demo.snapshotId}|replay|${asOf}`;
    const controller = new AbortController();
    fetch(`/api/context?placeId=${encodeURIComponent(place.id)}&snapshotId=${encodeURIComponent(demo.snapshotId)}&asOf=${encodeURIComponent(asOf)}&mode=replay`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((body: PlaceContext) => {
        if (body.contextVersion === active) setContext(body);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [asOf, demo.snapshotId, mode, place]);

  async function tryLive() {
    setMode("live");
    setLiveMessage(null);
    const response = await fetch("/api/observations?mode=live");
    const body = await response.json();
    if (!response.ok) {
      setLiveMessage(body.error?.message ?? "Live observations are unavailable.");
      return;
    }
    setLiveMessage("A live response arrived. This screen stays on the replay snapshot so the two modes are not mixed.");
  }

  async function playBriefing() {
    if (!place) return;
    const versionAtStart = versionRef.current;
    const response = await fetch("/api/voice/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId: place.id, snapshotId: demo.snapshotId, asOf, mode: "replay" }),
    });
    if (versionRef.current !== versionAtStart) return;
    if (!response.ok || response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.json();
      setVoiceMessage(body.error?.message ?? "Spoken audio is unavailable.");
      return;
    }
    if (response.headers.get("X-Context-Version") !== versionAtStart) return;
    const blob = await response.blob();
    if (versionRef.current !== versionAtStart) return;
    const audio = new Audio(URL.createObjectURL(blob));
    audioRef.current = audio;
    setVoiceMessage("Playing the server briefing.");
    await audio.play();
  }

  async function copyBriefing() {
    await navigator.clipboard.writeText(context.briefingText);
    setVoiceMessage("Briefing copied.");
  }

  if (!place) {
    return <p className="empty-state">No communities are in the catalog.</p>;
  }

  return (
    <div className="workspace">
      <section className="communities" aria-labelledby="community-heading">
        <h2 id="community-heading">Communities</h2>
        <p className="subtle">Representative Census coordinates. Not households or boundaries.</p>
        <div className="community-buttons">
          {demo.places.map((item) => (
            <button
              key={item.id}
              type="button"
              className="place"
              aria-pressed={item.id === place.id}
              onClick={() => {
                setPlaceId(item.id);
                setSelectedId(null);
                setMode("replay");
              }}
            >
              <span className="place-name">{item.name}</span>
              <span className="place-meta">{item.censusName}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="map-area" aria-labelledby="map-heading">
        <div className="map-head">
          <div>
            <h2 id="map-heading">{place.name}</h2>
            <small>
              {mode === "replay" ? "Replay" : "Live"} cutoff {formatUtc(asOf)}. Retrieved {formatUtc(demo.fetchedAt)}.
            </small>
          </div>
          <div className="mode-switch">
            <button type="button" aria-pressed={mode === "replay"} onClick={() => { setMode("replay"); setLiveMessage(null); }}>Replay</button>
            <button type="button" aria-pressed={mode === "live"} onClick={tryLive}>Live</button>
          </div>
        </div>
        {liveMessage ? <p className="status-line">{liveMessage}</p> : null}
        <div className="map-wrap">
          <ObservationMap observations={visible} place={place} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="map-foot">
          <span><i className="obs-key high" /> High confidence</span>
          <span><i className="obs-key nominal" /> Nominal confidence</span>
          <span><i className="obs-key low" /> Low confidence, not used for the band</span>
          <span><i className="sel-key" /> Selected community</span>
        </div>
        <div className="timeline">
          <label htmlFor="cutoff">Observation cutoff</label>
          <input
            id="cutoff"
            type="range"
            min={0}
            max={Math.max(0, times.length - 1)}
            value={Math.max(0, timeIndex)}
            onChange={(event) => {
              const next = times[Number(event.target.value)];
              if (next) {
                setAsOf(next);
                setMode("replay");
              }
            }}
          />
          <p>
            {formatUtc(asOf)} ({formatPacific(asOf)}). {summary.count} observations acquired since the previous cutoff. These are observations, not newly ignited fires.
          </p>
        </div>
      </section>
      <aside className="evidence-panel" aria-labelledby="briefing-heading">
        <h2 id="briefing-heading">{place.name}</h2>
        <p className="band" data-band={context.attentionBand}>{BAND_LABEL[context.attentionBand]}</p>
        <p className="briefing">{context.briefingText}</p>
        <p className="subtle">{context.countLast24h} qualifying observations in 24 hours. Nearest {context.nearestObservationKm === null ? "none" : formatKm(context.nearestObservationKm)}.</p>
        <div className="actions">
          <button type="button" onClick={playBriefing}>Play spoken briefing</button>
          <button type="button" onClick={copyBriefing}>Copy briefing</button>
          <button type="button" onClick={() => window.print()}>Print briefing</button>
        </div>
        <p className="voice-note">{voiceMessage}</p>
        <h3>Official information</h3>
        <ul>
          {place.officialInfoLinks.map((link) => (
            <li key={link.url}><a href={link.url}>{link.label}</a></li>
          ))}
        </ul>
        <div className="list-head">
          <h3>Observations</h3>
          <button type="button" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Nearby only" : "All in snapshot"}
          </button>
        </div>
        <p className="subtle">{listed.length} shown of {visible.length} at or before the cutoff. The list works when the map does not.</p>
        <ul className="observation-list">
          {listed.slice(0, 40).map(({ observation, kilometers }) => (
            <li key={observation.id}>
              <button type="button" aria-pressed={observation.id === selectedId} onClick={() => setSelectedId(observation.id)}>
                <span>{observation.confidence} · {formatKm(kilometers)}</span>
                <span>{formatUtc(observation.observedAt)}</span>
                <span>FRP {observation.frpMw === null ? "missing" : `${observation.frpMw} MW`}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
