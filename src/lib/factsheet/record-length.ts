/**
 * The record length, stated one way (Phase 169 D-12, D-25; SC5).
 *
 * Every factsheet site that states how long a record is (the Strategy Thesis
 * sentence, "Years Observed", the Main Metrics observation warning and the Terms
 * panel's "Sample size") formats it here, so the page cannot state it two ways.
 *
 * Unit contract:
 *   - `years` is CALENDAR years, exactly as `compute()` reports it (first to
 *     last observation date, whole days / 365: F-5, Q1). This module has no other clock and
 *     never derives years from `n`: an observation count divided by 252 or by
 *     `periodsPerYear` reads a sparse or a 24/7 record as the wrong length.
 *   - `n` is the observation COUNT, one per daily return in the series. It is
 *     stated as "daily observations", never "trading days", because a 24/7
 *     venue has no trading days.
 *   - A non-finite value is the em-dash, never 0 (DESIGN.md Numbers Contract).
 */

import { wholeCalendarDays } from "@/lib/figure-conventions";
import { formatDay } from "@/lib/utils";

export type RecordLength = {
  /** Calendar years to two decimals ("0.45"), or "—". */
  years: string;
  /** The count with thousands separators ("166 daily observations"). */
  observations: string;
  /** The whole statement ("0.45 years, 166 daily observations"). */
  text: string;
};

export function formatRecordLength({ n, years }: { n: number; years: number }): RecordLength {
  const yearsText = Number.isFinite(years) ? years.toFixed(2) : "—";
  const count = Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
  const observations = `${count} daily ${n === 1 ? "observation" : "observations"}`;
  const yearsPart = yearsText === "—" ? "—" : `${yearsText} years`;
  return { years: yearsText, observations, text: `${yearsPart}, ${observations}` };
}

/** An ISO day ("2024-03-14") as UTC milliseconds, or null when it is not a real calendar day. */
function readIsoDay(value: string | null | undefined): number | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Date.UTC rolls "2025-13-45" over into a later day; a real day reads back as itself.
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? ms : null;
}

/**
 * The one muted line stating the span CAGR covers (Phase 236, FIG-04, CONTEXT Q1):
 * "CAGR over Mar 14, 2024 to Nov 2, 2025 (598 days)", the dates printed by `formatDay`, the repo's one
 * UI date (Phase 201 D-11; the copy census's rule C fails a month list written here).
 *
 * The days are WHOLE first-to-last days from `wholeCalendarDays`, the count the CAGR itself
 * annualizes on. That differs from `coveredDays` (inclusive, +1) on purpose: this line states the
 * clock behind the figure, and the figure's clock has no +1. An emptied stretch inside the span
 * stays in it, because the span is first-to-last observed day.
 *
 * Null (the caller renders nothing) when either end is absent, is not a real day, or the span is
 * not a span (same day or reversed). Never invented text: a row stored before the keys existed
 * simply has no line.
 */
export function formatCagrSpan(start: string | null | undefined, end: string | null | undefined): string | null {
  const startMs = readIsoDay(start);
  const endMs = readIsoDay(end);
  if (startMs === null || endMs === null) return null;
  const days = wholeCalendarDays(startMs, endMs);
  if (days < 1) return null;
  return `CAGR over ${formatDay(start)} to ${formatDay(end)} (${days} ${days === 1 ? "day" : "days"})`;
}
