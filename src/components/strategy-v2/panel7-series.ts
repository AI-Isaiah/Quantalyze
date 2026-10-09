import type { AnalyticsDataQualityFlags } from "@/lib/types";

/**
 * Phase 170.5 (D-03, D-04) — draw guards and say-why ladders for the two lazy
 * series in Panel 7 (Exposure & benchmark greeks).
 *
 * Pure and React-free. The lazy RPC payload is untrusted JSONB, so both series
 * arrive typed `unknown` and the guards own the shape:
 *
 *   - Exposure: a point is kept when `date` is a string and `gross` and `net`
 *     are finite numbers. Producer shape: `ExposurePoint` in
 *     `analytics-service/services/position_reconstruction.py` (USD notional).
 *   - Turnover: a point is kept when `date` is a string and `value` is a finite
 *     number, the contract `TurnoverChart` (percent of NAV) was built for. The
 *     stored rows are `{date, turnover}` with price-scaled values and no writer
 *     (Phase 106 Stage B). They are never mapped to `value` and never charted.
 *
 * The ladders run only when the guard kept fewer than 2 points, so a valid
 * series always draws whatever the source flags say. Data-shape rungs come
 * before the source rung. Copy is the UI-SPEC's, verbatim; no sentence names a
 * job, worker or row.
 *
 * "Absent or empty" means: not an array, or an array of length 0.
 */

export interface ExposureSeriesPoint {
  date: string;
  gross: number;
  net: number;
}

export interface TurnoverSeriesPoint {
  date: string;
  value: number;
}

interface SeriesWhyInputs {
  exposure: unknown;
  turnover: unknown;
  flags: AnalyticsDataQualityFlags | null | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Not an array, or an array of length 0. */
function isAbsentOrEmpty(series: unknown): boolean {
  return !Array.isArray(series) || series.length === 0;
}

export function keepExposurePoints(raw: unknown): ExposureSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  const kept: ExposureSeriesPoint[] = [];
  for (const entry of raw) {
    if (
      isRecord(entry) &&
      typeof entry.date === "string" &&
      isFiniteNumber(entry.gross) &&
      isFiniteNumber(entry.net)
    ) {
      kept.push({ date: entry.date, gross: entry.gross, net: entry.net });
    }
  }
  return kept;
}

export function keepTurnoverPoints(raw: unknown): TurnoverSeriesPoint[] {
  if (!Array.isArray(raw)) return [];
  const kept: TurnoverSeriesPoint[] = [];
  for (const entry of raw) {
    if (
      isRecord(entry) &&
      typeof entry.date === "string" &&
      isFiniteNumber(entry.value)
    ) {
      kept.push({ date: entry.date, value: entry.value });
    }
  }
  return kept;
}

/** An entry with an own `turnover` key and no finite `value`: the price-scaled legacy row. */
function hasLegacyTurnoverRow(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some(
    (entry) =>
      isRecord(entry) &&
      Object.prototype.hasOwnProperty.call(entry, "turnover") &&
      !isFiniteNumber(entry.value),
  );
}

/** Why Net & gross exposure has nothing to draw. Callers ask only when fewer than 2 points were kept. */
export function exposureWhy({ exposure, turnover, flags }: SeriesWhyInputs): string {
  if (!isAbsentOrEmpty(exposure)) {
    return "Net and gross exposure isn’t available for this strategy: the stored series has fewer than 2 valid points.";
  }
  if (isAbsentOrEmpty(turnover) && flags?.csv_source === true) {
    return "Net and gross exposure isn’t available for this strategy: it was uploaded as a CSV file, and no position-level series is stored for it.";
  }
  return "Net and gross exposure isn’t available for this strategy: no position-snapshot exposure series is stored for it.";
}

/** Why Turnover has nothing to draw. Callers ask only when fewer than 2 points were kept. */
export function turnoverWhy({ exposure, turnover, flags }: SeriesWhyInputs): string {
  if (hasLegacyTurnoverRow(turnover)) {
    return "Turnover isn’t available for this strategy: the stored turnover figures are not on a percent-of-NAV scale, so they are not shown.";
  }
  if (!isAbsentOrEmpty(turnover)) {
    return "Turnover isn’t available for this strategy: the stored series has fewer than 2 valid points.";
  }
  if (isAbsentOrEmpty(exposure) && flags?.csv_source === true) {
    return "Turnover isn’t available for this strategy: it was uploaded as a CSV file, and no position-level series is stored for it.";
  }
  return "Turnover isn’t available for this strategy: no turnover series is computed for it.";
}
