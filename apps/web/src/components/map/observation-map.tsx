"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MONITOR_KM, REVIEW_KM, type Place, type ThermalObservation } from "@emberready/domain";
import type { RiskTier } from "../../lib/risk";

/** Ranked cells to shade, from the research danger-zone model. */
export interface RiskLayer {
  polygons: [number, number][][];
  tier: RiskTier[];
  rank: number[];
}

interface ObservationMapProps {
  risk: RiskLayer | null;
  observations: ThermalObservation[];
  freshIds: Set<string>;
  asOf: string | undefined;
  place: Place;
  bbox: [number, number, number, number];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const COLOR = ["match", ["get", "confidence"], "high", "#ff5a1f", "nominal", "#ffb03a", "#7d8590"] as const;
const EMPTY = { type: "FeatureCollection" as const, features: [] };

function ring(place: Place, km: number, band: string) {
  const coordinates: [number, number][] = [];
  const lat = (place.latitude * Math.PI) / 180;
  for (let step = 0; step <= 96; step += 1) {
    const angle = (step / 96) * 2 * Math.PI;
    coordinates.push([
      place.longitude + (km / (111.32 * Math.cos(lat))) * Math.cos(angle),
      place.latitude + (km / 110.574) * Math.sin(angle),
    ]);
  }
  return { type: "Feature" as const, geometry: { type: "LineString" as const, coordinates }, properties: { band } };
}

export function ObservationMap({ risk, observations, freshIds, asOf, place, bbox, selectedId, onSelect }: ObservationMapProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const initialBbox = useRef(bbox);
  const firstPlace = useRef(true);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark",
        bounds: initialBbox.current,
        fitBoundsOptions: { padding: 32 },
        attributionControl: { compact: true },
      });
    } catch {
      setFailure("The map is unavailable because WebGL could not start. Use the observation list and briefing.");
      return;
    }
    map.on("error", () => setFailure("Map tiles could not load. Use the observation list and briefing."));
    map.getCanvas().addEventListener("webglcontextlost", () => setFailure("The map lost its graphics connection. Use the observation list."));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.resize();
      // Danger zones sit underneath everything else so detections stay readable.
      map.addSource("risk", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "risk-fill", type: "fill", source: "risk",
        paint: {
          "fill-color": ["match", ["get", "tier"], "highest", "#ff3b30", "high", "#ff8a00", "#ffd166"],
          "fill-opacity": ["match", ["get", "tier"], "highest", 0.42, "high", 0.26, 0.13],
        },
      });
      map.addLayer({
        id: "risk-edge", type: "line", source: "risk",
        filter: ["==", ["get", "tier"], "highest"],
        paint: { "line-color": "#ff6b5f", "line-width": 1, "line-opacity": 0.9 },
      });
      map.addSource("rings", { type: "geojson", data: EMPTY });
      map.addSource("observations", { type: "geojson", data: EMPTY });
      map.addSource("place", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "rings", type: "line", source: "rings",
        paint: {
          "line-color": ["match", ["get", "band"], "review", "#ff5a1f", "#5ce1e6"],
          "line-opacity": 0.55,
          "line-width": 1.25,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "obs-glow", type: "circle", source: "observations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 22],
          "circle-color": COLOR as never,
          "circle-blur": 1,
          "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.55, 24, 0.3, 168, 0.08],
        },
      });
      map.addLayer({
        id: "obs-pulse", type: "circle", source: "observations",
        filter: ["==", ["get", "fresh"], true],
        paint: { "circle-radius": 8, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 1.5, "circle-stroke-color": COLOR as never, "circle-stroke-opacity": 0 },
      });
      map.addLayer({
        id: "observations", type: "circle", source: "observations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["==", ["get", "selected"], true], 7, 2.75], 10, ["case", ["==", ["get", "selected"], true], 9, 5]],
          "circle-color": COLOR as never,
          "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 1, 24, 0.85, 168, 0.4],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 2.5, 0],
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "place-halo", type: "circle", source: "place",
        paint: { "circle-radius": 14, "circle-color": "#5ce1e6", "circle-opacity": 0.15 },
      });
      map.addLayer({
        id: "place", type: "circle", source: "place",
        paint: { "circle-radius": 5, "circle-color": "#07090c", "circle-stroke-width": 2.5, "circle-stroke-color": "#5ce1e6" },
      });
      setLoaded(true);
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    map.on("click", "observations", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectRef.current(id);
    });
    map.on("mouseenter", "observations", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "observations", () => { map.getCanvas().style.cursor = ""; });

    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pulse = (time: number) => {
      if (map.getLayer("obs-pulse")) {
        const t = (time % 1600) / 1600;
        map.setPaintProperty("obs-pulse", "circle-radius", 6 + t * 22);
        map.setPaintProperty("obs-pulse", "circle-stroke-opacity", 0.9 * (1 - t));
      }
      frame = requestAnimationFrame(pulse);
    };
    if (!reduced) frame = requestAnimationFrame(pulse);

    mapRef.current = map;
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const features = risk
      ? risk.polygons.flatMap((ring, i) => risk.tier[i] === "low" ? [] : [{
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [ring] },
        properties: { tier: risk.tier[i], rank: risk.rank[i] },
      }])
      : [];
    (map.getSource("risk") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [risk, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const end = asOf ? Date.parse(asOf) : 0;
    (map.getSource("observations") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: observations.map((observation) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [observation.longitude, observation.latitude] },
        properties: {
          id: observation.id,
          confidence: observation.confidence,
          selected: observation.id === selectedId,
          fresh: freshIds.has(observation.id),
          age: Math.max(0, (end - Date.parse(observation.observedAt)) / 3_600_000),
        },
      })),
    });
  }, [observations, freshIds, asOf, selectedId, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("place") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [place.longitude, place.latitude] }, properties: {} }],
    });
    (map.getSource("rings") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [ring(place, REVIEW_KM, "review"), ring(place, MONITOR_KM, "monitor")],
    });
    if (firstPlace.current) { firstPlace.current = false; return; }
    map.flyTo({ center: [place.longitude, place.latitude], zoom: 8.4, speed: 1.4, essential: false });
  }, [place, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    const selected = observations.find((row) => row.id === selectedId);
    if (!map || !loaded || !selected) return;
    const bounds = map.getBounds();
    if (!bounds.contains([selected.longitude, selected.latitude])) map.easeTo({ center: [selected.longitude, selected.latitude] });
  }, [selectedId, observations, loaded]);

  return <>
    <div ref={containerRef} className="map-canvas" aria-label="Map of thermal observations" />
    <button type="button" className="map-reset" onClick={() => mapRef.current?.fitBounds(bbox, { padding: 32 })}>Statewide</button>
    {failure ? <div className="map-fallback" role="status"><p>{failure}</p><a href="#observation-list">Open observation list</a></div> : null}
  </>;
}
