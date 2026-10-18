import { distanceKm, formatKm, roundKm } from "./geo";
import { atOrBefore, formatPacific, formatUtc, inAttentionWindow } from "./time";
import {
  ATTENTION_HOURS,
  ATTENTION_RULE_VERSION,
  MONITOR_KM,
  REVIEW_KM,
  type AttentionBand,
  type FetchStatus,
  type Mode,
  type Place,
  type PlaceContext,
  type SnapshotResponse,
  type SnapshotWarning,
  type SourceStatus,
  type ThermalObservation,
} from "./types";

export function contextVersion(input: {
  placeId: string;
  snapshotId: string;
  mode: Mode;
  asOf: string;
}): string {
  return `${input.placeId}|${input.snapshotId}|${input.mode}|${input.asOf}`;
}

export function acceptsAudioResponse(activeVersion: string, responseVersion: string): boolean {
  return activeVersion === responseVersion;
}

export function observationsAtOrBefore(
  observations: ThermalObservation[],
  asOf: string,
): ThermalObservation[] {
  return observations
    .filter((observation) => atOrBefore(observation.observedAt, asOf))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
}

function bandMeaning(band: AttentionBand): string {
  if (band === "review") return "Review nearby thermal observations.";
  if (band === "monitor") return "Observed activity in the wider area.";
  if (band === "no-signal") return "No matching observations in this snapshot.";
  return "Data needs review before interpretation.";
}

export function buildBriefing(input: {
  place: Place;
  mode: Mode;
  asOf: string;
  fetchStatus: FetchStatus;
  fetchedAt: string | null;
  countLast24h: number;
  countWithin25km: number;
  nearestObservationKm: number | null;
  latestQualifyingAt: string | null;
  attentionBand: AttentionBand;
}): string {
  const placeTime = `${input.place.name} is shown in ${input.mode} mode. The selected cutoff is ${formatUtc(input.asOf)} (${formatPacific(input.asOf)}).`;
  let evidence: string;
  if (input.fetchStatus === "unavailable") {
    evidence = "The thermal observation source is unavailable. This briefing cannot describe nearby activity from a missing feed.";
  } else if (input.fetchStatus === "stale") {
    evidence = "The live feed could not be refreshed. Review the retained source and retrieval time before interpreting nearby activity.";
  } else if (input.countLast24h === 0) {
    evidence = "No nominal or high confidence thermal observations were acquired in the Washington snapshot during the 24 hours ending at the cutoff.";
  } else {
    const nearest = input.nearestObservationKm === null ? "an unknown distance" : formatKm(input.nearestObservationKm);
    const latest = input.latestQualifyingAt ? formatUtc(input.latestQualifyingAt) : "unknown";
    evidence = `${input.countLast24h} nominal or high confidence thermal observations were acquired in the Washington snapshot during the 24 hours ending at the cutoff. ${input.countWithin25km} of them are within 25 km. The nearest is ${nearest} from the representative place coordinate. The latest qualifying observation time is ${latest}.`;
  }
  const retrieved = input.fetchedAt
    ? `The source file was retrieved at ${formatUtc(input.fetchedAt)}.`
    : "The source retrieval time is not available.";
  const band = `Attention band ${input.attentionBand} means ${bandMeaning(input.attentionBand)} Rule version ${ATTENTION_RULE_VERSION}. Distances of 5 km and 25 km sort observations for this demo. They are not a fire probability, a perimeter, or an evacuation instruction.`;
  const limits = "Satellite coverage can be incomplete. No detections does not establish safety. Evacuation status, road access, and current weather are outside this dataset. Use the official information links.";
  const replay = input.mode === "replay"
    ? "This is an observation-time replay. Current weather and current alerts are not included."
    : "Live mode uses the current provider response and does not fill gaps with the replay snapshot.";
  return [placeTime, evidence, retrieved, band, limits, replay].join(" ");
}

export function buildPlaceContext(input: {
  place: Place;
  snapshotId: string;
  mode: Mode;
  asOf: string;
  observations: ThermalObservation[];
  source: SourceStatus;
}): PlaceContext {
  const liveBlocked = input.mode === "live" && (input.source.fetchStatus === "stale" || input.source.fetchStatus === "unavailable");
  const qualifying = input.observations.filter(
    (observation) =>
      (observation.confidence === "nominal" || observation.confidence === "high") &&
      inAttentionWindow(observation.observedAt, input.asOf, ATTENTION_HOURS),
  );
  const ranked = qualifying
    .map((observation) => ({
      observation,
      kilometers: Math.round(distanceKm(
        input.place.latitude,
        input.place.longitude,
        observation.latitude,
        observation.longitude,
      ) * 1_000_000) / 1_000_000,
    }))
    .sort((a, b) => a.kilometers - b.kilometers || a.observation.id.localeCompare(b.observation.id));

  let attentionBand: AttentionBand = "no-signal";
  let nearestObservationKm: number | null = null;
  let matchingObservationIds: string[] = [];
  let latestQualifyingAt: string | null = null;
  const reasons: string[] = [];

  if (liveBlocked) {
    attentionBand = "unknown";
    reasons.push(
      input.source.fetchStatus === "stale"
        ? "The live source is stale."
        : "The live source is unavailable.",
    );
  } else if (ranked.length === 0) {
    reasons.push("No nominal or high confidence observations fall in the 24 hour window.");
  } else {
    nearestObservationKm = roundKm(ranked[0].kilometers);
    matchingObservationIds = ranked.filter((item) => item.kilometers <= MONITOR_KM).map((item) => item.observation.id);
    latestQualifyingAt = ranked.map((item) => item.observation.observedAt).sort().at(-1) ?? null;
    if (ranked[0].kilometers <= REVIEW_KM) {
      attentionBand = "review";
      reasons.push(`The nearest qualifying observation is within ${REVIEW_KM} km.`);
    } else if (ranked[0].kilometers <= MONITOR_KM) {
      attentionBand = "monitor";
      reasons.push(`The nearest qualifying observation is over ${REVIEW_KM} km and within ${MONITOR_KM} km.`);
    } else {
      attentionBand = "no-signal";
      reasons.push(`The nearest qualifying observation is farther than ${MONITOR_KM} km.`);
    }
    reasons.push("Low confidence observations stay visible and do not set this band.");
  }

  const countLast24h = liveBlocked ? 0 : ranked.length;
  const countWithin25km = liveBlocked ? 0 : matchingObservationIds.length;
  return {
    contextVersion: contextVersion({
      placeId: input.place.id,
      snapshotId: input.snapshotId,
      mode: input.mode,
      asOf: input.asOf,
    }),
    placeId: input.place.id,
    snapshotId: input.snapshotId,
    mode: input.mode,
    asOf: input.asOf,
    nearestObservationKm: liveBlocked ? null : nearestObservationKm,
    matchingObservationIds: liveBlocked ? [] : matchingObservationIds,
    countLast24h,
    attentionBand,
    ruleVersion: ATTENTION_RULE_VERSION,
    reasons,
    sources: [{ ...input.source, newestObservationAt: observationsAtOrBefore(input.observations, input.asOf).at(-1)?.observedAt ?? null }],
    officialInfoLinks: input.place.officialInfoLinks,
    briefingText: buildBriefing({
      place: input.place,
      mode: input.mode,
      asOf: input.asOf,
      fetchStatus: input.source.fetchStatus,
      fetchedAt: input.source.fetchedAt,
      countLast24h,
      countWithin25km,
      nearestObservationKm: liveBlocked ? null : nearestObservationKm,
      latestQualifyingAt: liveBlocked ? null : latestQualifyingAt,
      attentionBand,
    }),
  };
}

export function visibleObservations(
  observations: ThermalObservation[],
  asOf: string,
): ThermalObservation[] {
  return observationsAtOrBefore(observations, asOf);
}

export function changeSummary(
  observations: ThermalObservation[],
  previousAsOf: string,
  asOf: string,
): { count: number; observationIds: string[] } {
  const ids = observations
    .filter((observation) => {
      const time = Date.parse(observation.observedAt);
      return time > Date.parse(previousAsOf) && time <= Date.parse(asOf);
    })
    .map((observation) => observation.id);
  return { count: ids.length, observationIds: ids };
}

export function snapshotWarnings(mode: Mode, visibleCount: number): SnapshotWarning[] {
  const warnings: SnapshotWarning[] = [];
  if (mode === "replay") {
    warnings.push({
      code: "observation-time-replay",
      message: "Historical replay shows observation time only. Current weather and current alerts are hidden.",
    });
  }
  if (visibleCount === 0) {
    warnings.push({
      code: "empty-selection",
      message: "No thermal observations were acquired at or before the selected cutoff.",
    });
  }
  return warnings;
}

export function buildSnapshotResponse(input: {
  snapshotId: string;
  mode: Mode;
  asOf: string;
  generatedAt: string;
  source: SourceStatus;
  observations: ThermalObservation[];
}): SnapshotResponse {
  const observations = visibleObservations(input.observations, input.asOf);
  return {
    schemaVersion: "1.0",
    snapshotId: input.snapshotId,
    mode: input.mode,
    asOf: input.asOf,
    generatedAt: input.generatedAt,
    sources: [{ ...input.source, newestObservationAt: observationsAtOrBefore(input.observations, input.asOf).at(-1)?.observedAt ?? null }],
    observations,
    warnings: snapshotWarnings(input.mode, observations.length),
  };
}
