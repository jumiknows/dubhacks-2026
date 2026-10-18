import { parse } from "csv-parse/sync";
import { parseFirmsAcquisition, type Confidence, type ThermalObservation } from "@emberready/domain";
import { sha256 } from "./hash";

export class FirmsParseError extends Error {
  constructor(readonly reason: "missing-header" | "malformed-csv" | "error-body") {
    super(reason);
  }
}

export interface QuarantineRecord {
  rowNumber: number;
  reason: string;
  value: string;
}

export interface ExcludedRecord {
  rowNumber: number;
  reason: "outside-region" | "outside-window";
}

export interface NormalizedObservation extends ThermalObservation {
  originalLatitude: string;
  originalLongitude: string;
}

export interface FirmsParseResult {
  rawRows: number;
  retained: NormalizedObservation[];
  duplicateRows: number;
  excluded: ExcludedRecord[];
  quarantined: QuarantineRecord[];
  conflicts: number;
}

const REQUIRED = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "version", "frp"];

export function parseFirmsCsv(
  text: string,
  options: {
    product: string;
    sourceId: string;
    rawSha256: string;
    bbox: [number, number, number, number];
    windowStart?: string;
    windowEnd?: string;
  },
): FirmsParseResult {
  const probe = text.trimStart();
  if (!probe || probe.startsWith("<") || probe.startsWith("{") || probe.startsWith("Invalid")) {
    throw new FirmsParseError(probe.startsWith("<") || probe.startsWith("{") ? "error-body" : "missing-header");
  }
  const headerLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const headers = headerLine.split(",").map((header) => header.trim());
  if (REQUIRED.some((header) => !headers.includes(header))) throw new FirmsParseError("missing-header");

  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: false,
      trim: false,
    }) as Record<string, string>[];
  } catch {
    throw new FirmsParseError("malformed-csv");
  }

  const [west, south, east, north] = options.bbox;
  const pending: Array<{ rowNumber: number; row: NormalizedObservation; signature: string; key: string }> = [];
  const quarantined: QuarantineRecord[] = [];
  const excluded: ExcludedRecord[] = [];
  let rowNumber = 1;

  records.forEach((record, index) => {
    rowNumber = index + 2;
    const latitudeText = record.latitude ?? "";
    const longitudeText = record.longitude ?? "";
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      quarantined.push({ rowNumber, reason: "invalid-coordinate", value: `${latitudeText},${longitudeText}` });
      return;
    }
    const observedAt = parseFirmsAcquisition(record.acq_date ?? "", record.acq_time ?? "");
    if (!observedAt) {
      quarantined.push({ rowNumber, reason: "invalid-time", value: `${record.acq_date} ${record.acq_time}` });
      return;
    }
    const confidenceRaw = (record.confidence ?? "").trim();
    const confidence = confidenceRaw.toLowerCase();
    if (confidence !== "low" && confidence !== "nominal" && confidence !== "high") {
      quarantined.push({ rowNumber, reason: "unknown-confidence", value: confidenceRaw });
      return;
    }
    const frpText = record.frp ?? "";
    let frpMw: number | null;
    if (frpText.trim() === "") frpMw = null;
    else if (!Number.isFinite(Number(frpText))) {
      quarantined.push({ rowNumber, reason: "invalid-frp", value: frpText });
      return;
    } else frpMw = Number(frpText);

    const satellite = (record.satellite ?? "").trim();
    const productVersion = (record.version ?? "").trim();
    if (!satellite || !productVersion) {
      quarantined.push({ rowNumber, reason: "missing-identity", value: `${satellite}|${productVersion}` });
      return;
    }
    if (longitude < west || longitude > east || latitude < south || latitude > north) {
      excluded.push({ rowNumber, reason: "outside-region" });
      return;
    }
    if (
      (options.windowStart && observedAt < options.windowStart) ||
      (options.windowEnd && observedAt > options.windowEnd)
    ) {
      excluded.push({ rowNumber, reason: "outside-window" });
      return;
    }

    const key = `${options.product}|${satellite}|${observedAt}|${latitudeText}|${longitudeText}`;
    const signature = JSON.stringify({ confidence, frpMw, productVersion, satellite, observedAt });
    pending.push({
      rowNumber,
      key,
      signature,
      row: {
        id: sha256(key).slice(0, 24),
        sourceId: options.sourceId,
        product: options.product,
        productVersion,
        satellite,
        latitude,
        longitude,
        observedAt,
        confidenceRaw,
        confidence: confidence as Confidence,
        rawRowId: `${options.rawSha256}:${rowNumber}`,
        frpMw,
        originalLatitude: latitudeText,
        originalLongitude: longitudeText,
      },
    });
  });

  const groups = new Map<string, typeof pending>();
  for (const item of pending) {
    const group = groups.get(item.key) ?? [];
    group.push(item);
    groups.set(item.key, group);
  }

  const retained: NormalizedObservation[] = [];
  let duplicateRows = 0;
  let conflicts = 0;
  for (const group of groups.values()) {
    const signatures = new Set(group.map((item) => item.signature));
    if (signatures.size > 1) {
      conflicts += 1;
      for (const item of group) {
        quarantined.push({
          rowNumber: item.rowNumber,
          reason: "conflicting-duplicate",
          value: item.key,
        });
      }
      continue;
    }
    retained.push(group[0].row);
    duplicateRows += group.length - 1;
  }

  retained.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
  return {
    rawRows: records.length,
    retained,
    duplicateRows,
    excluded,
    quarantined,
    conflicts,
  };
}
