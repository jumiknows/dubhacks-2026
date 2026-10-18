/** Research danger-zone rankings (research/wildfire). Shared by the server routes and the map. */

export type RiskTier = "highest" | "high" | "elevated" | "low";
export type RiskStatus = "complete" | "partial" | "unavailable";

export interface RiskCoverage {
  thermalDays: number;
  thermalDaysNeeded: number;
  weatherForPreviousDay: boolean;
}

export interface RiskSummary {
  experiment: string;
  label: string;
  framing: string;
  model: { algorithm: string; trainedYears: number[]; calibratedOn: number[] };
  test: { years: number[]; prAuc: number; prevalence: number; recallAtBudget: number; budgetCellsPerDay: number; recallAtBudget95ci: [number, number] };
  tiers: Record<string, string>;
  plainLanguage: Record<string, string>;
  dates: Record<string, { date: string; status: RiskStatus; coverage: RiskCoverage }>;
}

export interface RiskGrid {
  cellIds: string[];
  polygons: [number, number][][];
  placeCells: Record<string, number>;
}

export interface RiskDay {
  date: string;
  status: RiskStatus;
  coverage: RiskCoverage;
  dataThrough: string;
  cells: {
    probability: number[];
    rank: number[];
    tier: RiskTier[];
    /** Up to three [feature, value, SHAP contribution] entries per cell, largest first. */
    top: [string, number, number][][];
  };
}

/** The ranking day for a cutoff is the cutoff's Pacific date: it only uses data through the day before. */
export function riskDateFor(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts;
}

export const TIER_LABEL: Record<RiskTier, string> = {
  highest: "Highest",
  high: "High",
  elevated: "Elevated",
  low: "Lower",
};
