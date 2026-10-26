/**
 * Phase 167.2.1.1.1 (NAVMTM) plan 10: the start-of-marks note, D-08 / D-12 / L2.
 *
 * L2: "where marked days meet realized-basis days the curve may step. The step
 * stays, the boundary date is stored, and no values are invented." D-12: the
 * compute writes the marks-start date into the strategy's analytics data
 * (`strategy_analytics.data_quality_flags.marks_since`), which published
 * factsheets already read, and the owner-only marks table is never exposed.
 * D-08: a small dated note on the factsheet and on My Allocation wherever that
 * date falls inside the drawn range, drawn exactly as the approved
 * `167.2.1.1.1-UI-SPEC.md` says.
 *
 * This module is the ONLY reader of the published start date, and the one home
 * of the visibility rule, the label placement and the words, so both chart
 * hosts (the factsheet's `TimeSeriesChart` and My Allocation's `EquityChart`)
 * say the same thing in the same place. The calendar rule is the
 * snapshot-rebuild-boundary one (`isIsoCalendarDate`), imported rather than
 * copied, so a single definition of "a real date" serves both readers.
 *
 * The JSONB crosses from the worker into a typed value here, so it is
 * untrusted: only a real calendar date written exactly `YYYY-MM-DD` is
 * accepted. Absent is silent (no marks yet is not a defect); malformed logs one
 * reason-only warning and names nothing.
 */
import { estLabelWidth } from "@/lib/chart-ticks";
import { isIsoCalendarDate } from "@/lib/snapshot-rebuild-boundary";

/**
 * The key the Python analytics writer sets inside `data_quality_flags`. It is
 * pinned against `analytics_runner.py` and `job_worker.py` by
 * `src/__tests__/nav-marks-start-literal-pin.test.ts`, so the writer and this
 * reader cannot drift apart unnoticed.
 */
export const MARKS_SINCE_FLAG = "marks_since" as const;

/**
 * The sibling key the analytics service publishes next to `marks_since`: the
 * first day AFTER the last recorded mark when marks have stopped updating (the
 * series ends there). Read by the same parser. Pinned against the Python writers
 * by `src/__tests__/nav-marks-start-literal-pin.test.ts`.
 */
export const MARKS_TRAILING_SINCE_FLAG = "marks_trailing_since" as const;

/** DESIGN.md `tracking-wider`: 0.05 em of letter spacing on the data micro-label. */
export const MARKS_LABEL_TRACKING_EM = 0.05;

/** Gap between the marker line and its label, in the chart's own units (UI-SPEC "xs"). */
const LABEL_GAP = 4;

/** Logs the reason only, never the value read. */
function warnMalformed(reason: string): null {
  console.warn(
    `[nav-marks-start] ${MARKS_SINCE_FLAG} is malformed (${reason}); the chart names no recorded-equity start`,
  );
  return null;
}

/**
 * Parse the published start-of-marks date.
 *
 * Pure and total. `null` / `undefined` is the silent absent case. Anything that
 * is not a real `YYYY-MM-DD` calendar date yields `null` and one `console.warn`
 * carrying the reason only.
 */
export function parseMarksStart(value: unknown): string | null {
  if (value == null) return null;
  if (!isIsoCalendarDate(value)) {
    return warnMalformed("not a YYYY-MM-DD calendar date");
  }
  return value;
}

/**
 * UI-SPEC "Visibility rule": the note shows iff `first < start <= last`, where
 * `first` and `last` are the first and last days the chart is drawing right now.
 * `start == first` hides it (no earlier day is drawn, so no step is on screen to
 * name); `start == last` shows it. ISO dates compare chronologically as strings.
 */
export function marksStartInRange(start: string, range: { first: string; last: string }): boolean {
  return range.first < start && start <= range.last;
}

// ---- The words (UI-SPEC "Copywriting Contract"), as functions of the formatted date ----

/** In-chart label, both hosts. `date` is `formatIsoDate(start)`, e.g. "Mar 6, 2026". */
export function marksStartLabel(date: string): string {
  return `Recorded equity from ${date}`;
}

/**
 * The label as drawn: uppercase Geist Mono (DESIGN.md "Three voices"). The
 * uppercase string itself is rendered, not a CSS text-transform, so the exported
 * SVG and the measurement in {@link placeMarksStartLabel} carry the same characters.
 */
export function marksStartLabelRendered(date: string): string {
  return marksStartLabel(date).toUpperCase();
}

/**
 * The paused-marks note, shown beside the start-of-marks note when the marks
 * stopped updating. `date` is `formatIsoDate(day)`. Rendered uppercase (the
 * label voice) by the host's classes.
 */
export function marksTrailingNote(date: string): string {
  return `Marks paused from ${date}`;
}

/** Caption S1, always shown. Also the marker group's `<title>`. */
export function marksStartSentenceOne(date: string): string {
  return `Recorded equity, including unrealized P&L, begins on ${date}.`;
}

/** Caption S2, always shown. "can leave out" and "may step" stay true on every venue. */
export function marksStartSentenceTwo(): string {
  return "Earlier days are rebuilt from trade and balance history and can leave out unrealized P&L, so the curve may step on that day.";
}

/** Caption S3, multi-account charts only: the start is the earliest among several accounts. */
export function marksStartSentenceThree(): string {
  return "An account whose recording began later may step on its own first recorded day.";
}

/** The caption: S1 and S2, plus S3 when the chart draws several accounts. */
export function marksStartCaption(date: string, multiAccount: boolean): string {
  const sentences = [marksStartSentenceOne(date), marksStartSentenceTwo()];
  if (multiAccount) sentences.push(marksStartSentenceThree());
  return sentences.join(" ");
}

/**
 * UI-SPEC "The label placement rule": right of the line if it fits, else left of
 * it, else no label (the line and the caption stay). The label is never
 * truncated, shrunk or wrapped, so no SVG text is drawn past its bound
 * (NARROWCHARTS).
 *
 * `rendered` is the string as DRAWN (uppercase), so the width is the mono
 * advance (`estLabelWidth`, 0.6 em per character) plus the 0.05 em letter
 * tracking on every character. Deterministic arithmetic, not a DOM read, so the
 * server and the browser agree (React #418).
 */
export function placeMarksStartLabel(
  x: number,
  rendered: string,
  fontSize: number,
  plotLeft: number,
  plotRight: number,
): { x: number; textAnchor: "start" | "end" } | null {
  const w = estLabelWidth(rendered, fontSize) + rendered.length * fontSize * MARKS_LABEL_TRACKING_EM;
  if (x + LABEL_GAP + w <= plotRight) return { x: x + LABEL_GAP, textAnchor: "start" };
  if (x - LABEL_GAP - w >= plotLeft) return { x: x - LABEL_GAP, textAnchor: "end" };
  return null;
}
