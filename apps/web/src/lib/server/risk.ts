import bundle from "./risk.generated.json";
import type { RiskDay, RiskGrid, RiskSummary } from "../risk";

interface RiskBundle {
  index: RiskSummary | null;
  grid: RiskGrid | null;
  days: Record<string, RiskDay>;
}

const risk = bundle as unknown as RiskBundle;

export function riskSummary(): RiskSummary | null {
  return risk.index;
}

export function riskGrid(): RiskGrid | null {
  return risk.grid;
}

export function riskDay(date: string): RiskDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return risk.days[date] ?? null;
}
