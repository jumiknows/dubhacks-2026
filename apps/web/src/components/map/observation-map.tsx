"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Place, ThermalObservation } from "@emberready/domain";

interface ObservationMapProps {
  observations: ThermalObservation[];
  place: Place;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ObservationMap({ observations, place, selectedId, onSelect }: ObservationMapProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const initialPlace = useRef(place);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let map: maplibregl.Map;
    try { map = new maplibregl.Map({
      container,
      style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty",
      center: [initialPlace.current.longitude, initialPlace.current.latitude],
      zoom: 6,
    }); } catch {
      setFailure("The map is unavailable because WebGL could not start. Use the observation list and briefing below.");
      return;
    }
    map.on("error", () => setFailure("Map tiles could not load. Use the observation list and briefing below."));
    map.getCanvas().addEventListener("webglcontextlost", () => setFailure("The map lost its graphics connection. Use the observation list below."));
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");
    const resize = () => map.resize();
    map.on("load", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    map.on("click", "observations", (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectRef.current(id);
    });
    map.on("mouseenter", "observations", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "observations", () => {
      map.getCanvas().style.cursor = "";
    });
    mapRef.current = map;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const collection = {
      type: "FeatureCollection" as const,
      features: observations.map((observation) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [observation.longitude, observation.latitude] },
        properties: {
          id: observation.id,
          confidence: observation.confidence,
          selected: observation.id === selectedId,
        },
      })),
    };
    const placeCollection = {
      type: "FeatureCollection" as const,
      features: [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [place.longitude, place.latitude] },
        properties: { name: place.name },
      }],
    };
    const apply = () => {
      const existing = map.getSource("observations") as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(collection);
        (map.getSource("place") as GeoJSONSource).setData(placeCollection);
        return;
      }
      map.addSource("observations", { type: "geojson", data: collection });
      map.addLayer({
        id: "observations",
        type: "circle",
        source: "observations",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 8, 5],
          "circle-color": ["match", ["get", "confidence"], "high", "#b54f22", "nominal", "#1b536f", "#6b6256"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addSource("place", { type: "geojson", data: placeCollection });
      map.addLayer({
        id: "place",
        type: "circle",
        source: "place",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#1b536f",
        },
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
    map.easeTo({ center: [place.longitude, place.latitude], duration: 0 });
    return () => { map.off("load", apply); };
  }, [observations, place, selectedId]);

  return <>
    <div ref={containerRef} className="map-canvas" aria-label="Map of thermal observations" />
    {failure ? <div className="map-fallback" role="status"><p>{failure}</p><a href="#observation-list">Open observation list</a></div> : null}
    <div className="map-attribution">Basemap: <a href="https://openfreemap.org/">OpenFreeMap</a>, <a href="https://www.openmaptiles.org/">OpenMapTiles</a> and <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></div>
  </>;
}
