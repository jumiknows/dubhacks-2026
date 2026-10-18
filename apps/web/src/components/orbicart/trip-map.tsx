"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type LayerId = "precipitation" | "snow" | "true_color" | "fires";
export type Layers = Record<LayerId, boolean>;

interface TripMapProps {
  place: { latitude: number; longitude: number; name: string } | null;
  layers: Layers;
  /** Date of the NASA GIBS imagery to show, YYYY-MM-DD. */
  imageryDate: string;
  fires: { latitude: number; longitude: number }[];
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };
// NASA GIBS (Global Imagery Browse Services) daily layers, web-mercator tiles.
const GIBS = (layer: string, level: number, ext: string, date: string) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;
const RASTERS: { id: Exclude<LayerId, "fires">; layer: string; level: number; ext: string; opacity: number }[] = [
  { id: "true_color", layer: "MODIS_Terra_CorrectedReflectance_TrueColor", level: 9, ext: "jpg", opacity: 0.85 },
  { id: "snow", layer: "MODIS_Terra_NDSI_Snow_Cover", level: 8, ext: "png", opacity: 0.8 },
  { id: "precipitation", layer: "IMERG_Precipitation_Rate", level: 6, ext: "png", opacity: 0.75 },
];

function ring(lat: number, lon: number, km: number) {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= 96; i += 1) {
    const a = (i / 96) * 2 * Math.PI;
    coordinates.push([lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 110.574) * Math.sin(a)]);
  }
  return { type: "Feature" as const, geometry: { type: "LineString" as const, coordinates }, properties: {} };
}

export function TripMap({ place, layers, imageryDate, fires }: TripMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark",
        center: [-120.5, 44], zoom: 3.2, attributionControl: { compact: true },
      });
    } catch {
      setFailure("The map needs WebGL. Your kit and products still work without it.");
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
      for (const r of RASTERS) {
        map.addSource(r.id, { type: "raster", tiles: [GIBS(r.layer, r.level, r.ext, imageryDate)], tileSize: 256, maxzoom: r.level, attribution: "NASA GIBS" });
        map.addLayer({ id: r.id, type: "raster", source: r.id, paint: { "raster-opacity": r.opacity }, layout: { visibility: "none" } }, firstLabel);
      }
      map.addSource("fires", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "fires-glow", type: "circle", source: "fires", layout: { visibility: "none" }, paint: { "circle-radius": 10, "circle-color": "#ff5a1f", "circle-blur": 1, "circle-opacity": 0.6 } });
      map.addLayer({ id: "fires", type: "circle", source: "fires", layout: { visibility: "none" }, paint: { "circle-radius": 3, "circle-color": "#ff8a3d" } });
      map.addSource("place", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "place-ring", type: "line", source: "place", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#5ce1e6", "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
      map.addLayer({ id: "place-halo", type: "circle", source: "place", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 16, "circle-color": "#5ce1e6", "circle-opacity": 0.18 } });
      map.addLayer({ id: "place", type: "circle", source: "place", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": "#07090c", "circle-stroke-width": 2.5, "circle-stroke-color": "#5ce1e6" } });
      setLoaded(true);
    });
    map.on("error", (event) => { if (String(event.error?.message ?? "").includes("WebGL")) setFailure("The map could not start."); });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    mapRef.current = map;
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
    // The first imagery date seeds the sources. Later dates update tiles below.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    for (const r of RASTERS) {
      const source = map.getSource(r.id) as maplibregl.RasterTileSource | undefined;
      source?.setTiles([GIBS(r.layer, r.level, r.ext, imageryDate)]);
      map.setLayoutProperty(r.id, "visibility", layers[r.id] ? "visible" : "none");
    }
    for (const id of ["fires", "fires-glow"]) map.setLayoutProperty(id, "visibility", layers.fires ? "visible" : "none");
  }, [layers, imageryDate, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("fires") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: fires.map((f) => ({ type: "Feature", geometry: { type: "Point", coordinates: [f.longitude, f.latitude] }, properties: {} })),
    });
  }, [fires, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !place) return;
    (map.getSource("place") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [place.longitude, place.latitude] }, properties: {} }, ring(place.latitude, place.longitude, 25)],
    });
    map.flyTo({ center: [place.longitude, place.latitude], zoom: 7.2, speed: 1.2, essential: false });
  }, [place, loaded]);

  return <>
    <div ref={container} className="oc-map-canvas" aria-label={place ? `Map around ${place.name}` : "Map"} />
    {failure ? <p className="oc-map-fallback" role="status">{failure}</p> : null}
  </>;
}
