# Verified sources and limitations

Checked on 2026-10-18 UTC. API details and access conditions can change. Source documentation was reviewed, but authenticated NASA and Grok calls have not been run in this planning task.

## Required sources

| Source | Use | Access and important limitation |
| --- | --- | --- |
| [NASA FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) | Thermal observation feed | Free MAP_KEY registration. Select a small bounding box and one VIIRS product initially. |
| [FIRMS data availability](https://firms.modaps.eosdis.nasa.gov/api/data_availability/) | Choose an available replay date | Check product coverage before requesting historical data. |
| [FIRMS data tutorial](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html) | CSV ingestion reference | Verify headers and the selected product's attribute documentation. |
| [FIRMS sample ingest tutorial](https://firms.modaps.eosdis.nasa.gov/content/academy/data_ingest/firms_data_ingest.html) | Public sample acquisition fallback | Inspect actual sample geography and dates before selecting it for a demo. |
| [US Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) | Public place names and representative coordinates | Retain source vintage. These files are not live population or facility datasets. |
| [Washington wildfire resources](https://mil.wa.gov/wildfire) | Official information links | Link to the actual authority. Do not turn a general resource page into an asserted current evacuation status. |

FIRMS request shape:

```text
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}/{optional-start-date}
```

The current Area API documents a range of one to five days per request and a map-key transaction allowance. Keep the key on the server and omit it from logs and source URLs. A recent-data endpoint is not a guarantee that every historical date is available for every product.

NASA describes near-real-time availability globally as generally within three hours of satellite observation. Some US and Canada streams are faster. This is latency after an observation, not after ignition. The product must not promise universal minute-level detection.

NASA also documents [cloud and smoke limitations](https://wiki.earthdata.nasa.gov/spaces/FIRMS/blog/2024/08/07/382276882/The%2BImpact%2Bof%2BCloud%2Bon%2BActive%2BFire%2BDetections) and [active-fire data caveats](https://forum.earthdata.nasa.gov/viewtopic.php?t=5188). Satellite anomalies alone do not establish incident type, exact fire boundaries, or absence of fire when no detections are present.

## Grok Voice

Use the official [Speech to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech), [ephemeral-token guide](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens), and [Text to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech).

| Purpose | Current documented interface |
| --- | --- |
| Browser session credential | `POST https://api.x.ai/v1/realtime/client_secrets` from the server |
| Conversational Voice | `wss://api.x.ai/v1/realtime?model=grok-voice-latest` |
| Deterministic spoken briefing | `POST https://api.x.ai/v1/tts` |

The docs support custom function tools and browser authentication using an ephemeral token. Verify exact event handling and the current model before implementation. Keep a real API call and model identifier in the build evidence. Browser speech synthesis or a prerecorded file alone is not evidence that the app uses Grok Voice.

## Supporting and stretch sources

| Source | Useful capability | MVP decision |
| --- | --- | --- |
| [NWS API](https://www.weather.gov/documentation/services-web-api) | Weather forecasts and alerts | P1 context. Requires an identifying User-Agent. NWS alerts are not a complete evacuation-order feed. |
| [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/) | Dated satellite imagery for comparison | P2 visualization. Image tiles are not a calibrated analytical raster. |
| [USGS SRTM](https://www.usgs.gov/faqs/where-can-i-get-global-elevation-data) | Elevation for terrain and contours | P2. A DEM is not a fire spread model, and its acquisition date matters. |
| [Sentinel-2 NDMI reference](https://github.com/sentinel-hub/custom-scripts/blob/main/sentinel-2/ndmi/README.md) | Vegetation moisture proxy | Future research. Do not equate it with direct live soil dryness or ignition probability. |
| [ASTER SWIR advisory](https://asterweb.jpl.nasa.gov/swir-alert.asp) | Historical mineral mapping constraints | Outside MVP. ASTER SWIR observations after April 2008 are unusable according to this advisory. |

Optical mineral mapping does not directly reveal underground ore or see through dense vegetation. Mineral exploration requires its own data, ground truth, and validation. It should be a separate product investigation.

## Product and implementation references

- [Watch Duty overview](https://www.watchduty.org/how-it-works/overview): established wildfire awareness product. Our proposed advantage needs user validation.
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Node release policy](https://nodejs.org/en/about/previous-releases), and [MapLibre examples](https://maplibre.org/maplibre-gl-js/docs/examples/): implementation references.
- [Cursor project rules](https://cursor.com/docs/rules): the repository includes a project rule for this build.
- [Grok Bot overview](https://docs.x.ai/grok-bot/overview): connect the repo in the team's actual Grok environment before assigning work. No bot identity or connection is assumed here.
