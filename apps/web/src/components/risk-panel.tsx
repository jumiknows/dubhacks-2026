"use client";

import { TIER_LABEL, type RiskDay, type RiskSummary } from "../lib/risk";

const UNITS: Record<string, (value: number) => string> = {
  tmax: (v) => `${v.toFixed(0)} °C`, tmin: (v) => `${v.toFixed(0)} °C`, tmax_7d: (v) => `${v.toFixed(0)} °C`,
  rh: (v) => `${v.toFixed(0)}%`, vpd: (v) => `${v.toFixed(1)} kPa`, wind_max: (v) => `${v.toFixed(0)} m/s`,
  precip_1d: (v) => `${v.toFixed(1)} mm`, precip_7d: (v) => `${v.toFixed(0)} mm`, precip_30d: (v) => `${v.toFixed(0)} mm`,
  dry_days: (v) => `${v.toFixed(0)} days`, soil_wet: (v) => v.toFixed(2),
  det_1d: (v) => `${v.toFixed(0)} detections`, det_3d: (v) => `${v.toFixed(0)} detections`, det_7d: (v) => `${v.toFixed(0)} detections`,
  det3x3_3d: (v) => `${v.toFixed(0)} detections`, det3x3_7d: (v) => `${v.toFixed(0)} detections`, det5x5_7d: (v) => `${v.toFixed(0)} detections`,
  elev_mean: (v) => `${v.toFixed(0)} m`, slope_mean: (v) => `${v.toFixed(0)}°`,
};

function chance(probability: number): string {
  const perThousand = probability * 1000;
  if (perThousand < 0.5) return "less than 1 in 1,000";
  const rounded = perThousand < 10 ? Math.round(perThousand * 10) / 10 : Math.round(perThousand);
  return `about ${rounded} in 1,000`;
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

interface RiskPanelProps {
  summary: RiskSummary;
  date: string | null;
  day: RiskDay | null;
  cell: number | null;
  shown: boolean;
  onToggle: () => void;
}

export function RiskPanel({ summary, date, day, cell, shown, onToggle }: RiskPanelProps) {
  const listed = date ? summary.dates[date] : undefined;
  const cells = day?.cells;
  const total = cells?.rank.length ?? 0;
  const test = summary.test;
  return <section className="risk" aria-labelledby="risk-heading">
    <div className="risk-head">
      <h3 id="risk-heading">Danger zones</h3>
      <span className="risk-tag">Research model</span>
      <button type="button" className="chip" aria-pressed={shown} onClick={onToggle}>{shown ? "On map" : "Show on map"}</button>
    </div>
    {!date ? <p className="nothing">No ranking is available for this view.</p>
      : !day || !cells ? <p className="nothing">
        No ranking for {shortDate(date)}.{" "}
        {listed && !listed.coverage.weatherForPreviousDay ? "NASA weather for the day before is not published yet." : "This day was not scored."}
      </p>
      : cell === null ? <p className="nothing">This community is outside the ranked grid.</p>
      : <>
        <p className="risk-line">
          <b className="risk-tier" data-tier={cells.tier[cell]}>{TIER_LABEL[cells.tier[cell]]}</b>
          <span className="mono"> rank {cells.rank[cell].toLocaleString()} of {total.toLocaleString()} cells</span>
          <span className="subtle"> · {shortDate(day.date)}</span>
        </p>
        <p className="risk-chance">{capitalize(chance(cells.probability[cell]))} chance that a wildfire discovery is recorded in this 10 km cell that day.</p>
        <ul className="risk-reasons" aria-label="Main reasons">
          {cells.top[cell].map(([feature, value, contribution]) => <li key={feature} data-direction={contribution >= 0 ? "up" : "down"}>
            <span className="risk-arrow" aria-hidden="true">{contribution >= 0 ? "▲" : "▼"}</span>
            <span>{summary.plainLanguage[feature] ?? feature}{UNITS[feature] ? ` (${UNITS[feature](value)})` : ""}</span>
            <span className="sr-only">{contribution >= 0 ? "raises" : "lowers"} the ranking</span>
          </li>)}
        </ul>
        {day.status === "partial" ? <p className="risk-note">Partial inputs: satellite heat history covers {day.coverage.thermalDays} of {day.coverage.thermalDaysNeeded} days.</p> : null}
      </>}
    <details className="risk-about">
      <summary>How this works</summary>
      <p>A Random Forest trained on {test.years.length ? `${summary.model.trainedYears[0]} to ${summary.model.trainedYears.at(-1)}` : ""} Washington wildfire records (US Forest Service FPA FOD) with NASA satellite heat, NASA POWER weather and terrain. Each cell is ranked using data through the day before.</p>
      <p>On {test.years[0]} to {test.years.at(-1)}, which it never trained on, its top {test.budgetCellsPerDay} cells a day held {pct(test.recallAtBudget)} of recorded discoveries ({pct(test.recallAtBudget95ci[0])} to {pct(test.recallAtBudget95ci[1])}). Picking {test.budgetCellsPerDay} cells at random would hold about {pct(test.budgetCellsPerDay / Math.max(total, 1))}.</p>
      <p>{summary.framing} It is not a fire forecast, a perimeter or evacuation guidance.</p>
    </details>
  </section>;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
