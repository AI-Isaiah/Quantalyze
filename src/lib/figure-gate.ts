/**
 * Phase 194 plan 03 (TRUST-05, D-04 as superseded by D-15): the ONE verdict for an
 * annualised figure, and every user-facing sentence that explains it.
 *
 * Pure: no Date.now, no I/O, no inspection of a figure's magnitude (D-05). Every
 * surface (factsheet, tearsheet, lists, Holdings, Scenario) calls this module and
 * restates neither a threshold nor a sentence.
 *
 * D-15 in one paragraph: the strategy's TOTAL record decides whether annualised
 * figures (CAGR, volatility, Sharpe, Sortino, Calmar) are withheld. A crypto record
 * (periodsPerYear 365) clears at 90 covered days; a non-crypto record clears at 60
 * return observations. Once the record clears, the WINDOW the figures cover only
 * qualifies them: under 365 covered days they are `short` (shown with one muted
 * note), from 365 `full`. A selected range, blend overlap, half or rolling window is
 * never withheld for being short.
 */

import { SIX_MONTH_WINDOW_DAYS, THREE_MONTH_WINDOW_DAYS } from "@/lib/factsheet/compute";

/**
 * 194 D-15 (2026-11-07): the crypto bound, in COVERED days (D-20: first to last
 * return date, both counted). Same value as `MIN_ANNUALIZATION_DAYS` in analytics-service/services/metrics.py
 * (a vitest reads that file and pins the pair). Also the interim bound for a non-crypto row
 * whose stored `record_observations` is absent (A-194-D15-02).
 */
export const MIN_ANNUALIZATION_DAYS = 90;

/**
 * 194 D-15 (2026-11-07): the non-crypto bound, in RETURN OBSERVATIONS (about three months
 * of weekday trading). Same value as `MIN_ANNUALIZATION_OBS` in metrics.py (pinned).
 */
export const MIN_ANNUALIZATION_OBS = 60;

/** 194 D-15 (2026-11-07): a window covering at least this many days (D-20) carries no short-track note. */
export const ONE_YEAR_DAYS = 365;

/**
 * 194 D-02/D-03 (2026-11-07): the stored figure-definitions version (2 = historical VaR/CVaR,
 * calendar 3M/6M). Same value as `FIGURE_DEFS_VERSION` in metrics.py (pinned).
 */
export const FIGURE_DEFS_VERSION = 2;

export type FigureState = "withheld" | "short" | "full" | "null";

export interface FigureRecord {
  /** Days the returns cover, first to last return date both counted (D-20; from `headline_since` when chain-broken); null when unknown. */
  spanDays: number | null;
  /** Count of return observations; null when the stored row lacks it (pre-recompute). */
  observations: number | null;
  /** True when periodsPerYear is 365 (the house crypto convention). */
  crypto: boolean;
  /**
   * True when a series end or the headline start is PRESENT but is not a date (194 D-17, review R4 WR-02: an absent record
   * is unknown and shows the value; a present but malformed one must not). Such a record is withheld
   * (`recordClears` is false) and its reason names no length. Absent on every readable record.
   */
  unreadable?: true;
}

const DAY_MS = 86_400_000;

/**
 * The calendar GAP from `first` to `last` (ISO yyyy-mm-dd), UTC midnight to UTC midnight. This is
 * a gap, not a record length: the rolling calendar windows read it as "dates at least N days
 * before". A record's or window's length is `coveredDays` (D-20).
 */
export function spanDays(first: string, last: string): number {
  return Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS);
}

/**
 * 194 D-20 (founder, 2026-11-08, "Count returns"): the days a record or window COVERS, from its
 * first to its last return date, both ends counted: each daily return covers one day, so 365
 * daily returns cover 365 days and 90 cover 90. The ONE span every gate uses. TS twin of
 * `_index_span_days` in analytics-service/services/metrics.py and of the span arm of
 * get_verified_cohort_rank (a vitest pins all three).
 */
export function coveredDays(first: string, last: string): number {
  return spanDays(first, last) + 1;
}

const READABLE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a REAL calendar day written exactly `yyyy-mm-dd`. The shape alone, or a bare
 * `Date.parse`, let an impossible day such as `2026-02-31` roll forward into a real one, so this
 * also round-trips through `toISOString`. Phase 194.2 (D-01): TS, Python `_read_day`
 * (analytics-service/services/metrics.py) and SQL `ledger_refresh_parse_series_date` now agree
 * that an impossible calendar day, or a date with trailing text, is unreadable.
 */
export function isReadableDay(d: string): boolean {
  if (!READABLE_DAY.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/**
 * Phase 194.2 (194-MALFORMED-DATES-ABSENT, 194-SCENARIO-INTERIOR-DATES): the FIRST date on any of
 * the given date axes that `isReadableDay` rejects, or null when every date on every axis reads.
 * `axis` is the position of the axis as passed, `index` the position inside it. The one
 * interior-date check: the factsheet builder (cash, mark-to-market, smoothed) and the Scenario
 * factsheet payload both call it, so no producer keeps its own scan.
 */
export function firstUnreadableDate(
  ...axes: ReadonlyArray<readonly string[]>
): { axis: number; index: number; date: string } | null {
  for (let axis = 0; axis < axes.length; axis += 1) {
    const dates = axes[axis];
    for (let index = 0; index < dates.length; index += 1) {
      if (!isReadableDay(dates[index])) return { axis, index, date: dates[index] };
    }
  }
  return null;
}

/**
 * Phase 197 D-05: the first day of the record a row's figures are computed on. The LATER of
 * `seriesStart` and a READABLE `headlineSince` (a chain-broken row's headline covers only the
 * suffix; a present but unreadable one never wins the compare). `figureSpan` calls this, and the
 * Track cell's title prints it, so the span and the date beside it can never disagree.
 */
export function recordStartDay(input: { seriesStart: string; headlineSince?: string | null }): string {
  const { seriesStart, headlineSince } = input;
  return headlineSince && isReadableDay(headlineSince) && headlineSince > seriesStart ? headlineSince : seriesStart;
}

/**
 * The record's span in covered days (D-20). The start is `recordStartDay`. A `headlineSince`
 * that is present but not a date never wins the compare here, so this span alone would read the
 * generous `seriesStart` one; `figureRecord` marks such a record `unreadable` (withheld, R5 WR-02),
 * so that span is never what a gate judges on. Null when either series end is missing or
 * unparsable. Never negative.
 */
export function figureSpan(input: {
  seriesStart: string | null | undefined;
  seriesEnd: string | null | undefined;
  headlineSince?: string | null;
}): number | null {
  const { seriesStart, seriesEnd, headlineSince } = input;
  if (!seriesStart || !seriesEnd) return null;
  const days = coveredDays(recordStartDay({ seriesStart, headlineSince }), seriesEnd);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/**
 * Phase 197 D-05: a record under this many covered days reads `<1` in the Track column; from it, at
 * least 1. A month is the smallest unit Track names, and 30 days counts as one.
 */
export const TRACK_MIN_MONTH_DAYS = 30;

/**
 * Phase 197 D-05: the Track column's figure, whole months of record from the covered-day span
 * (`FigureRecord.spanDays`, the count the 194 gate reads). Null for an unknown span (the cell shows an
 * em dash), `"<1"` under `TRACK_MIN_MONTH_DAYS`, otherwise floor(days x 12 / ONE_YEAR_DAYS), at least 1.
 *
 * Divides by `ONE_YEAR_DAYS` (365), NOT the UI-SPEC's 365.25: with 365.25 a record of exactly 365
 * covered days prints 11 beside figures that carry no `<1y` marker. Track and the marker agree on
 * one row only when both use the same year. The `Math.max(1, ...)` clamp keeps a 30-day record at 1
 * (30 x 12 / 365 floors to 0).
 */
export function trackMonths(spanDays: number | null): number | "<1" | null {
  if (spanDays == null || !Number.isFinite(spanDays)) return null;
  if (spanDays < TRACK_MIN_MONTH_DAYS) return "<1";
  return Math.max(1, Math.floor((spanDays * 12) / ONE_YEAR_DAYS));
}

/**
 * Build the record a strategy or blend is judged on. The caller passes
 * `annualizationPeriods(asset_class)` for a strategy and `blendPeriodsPerYear(legs)` for a
 * blend, so the asset-class convention stays in `closed-sets.ts`.
 */
export function figureRecord(input: {
  seriesStart: string | null | undefined;
  seriesEnd: string | null | undefined;
  headlineSince?: string | null;
  observations: number | null | undefined;
  periodsPerYear: number;
}): FigureRecord {
  const obs = input.observations;
  // 194 R5 WR-02: `headlineSince` decides a chain-broken row's record length, so a present
  // but unparsable one is as unreadable as a malformed series end (an absent one is unknown).
  const unreadable = [input.seriesStart, input.seriesEnd, input.headlineSince].some((d) => !!d && !isReadableDay(d));
  return {
    spanDays: figureSpan(input),
    observations: typeof obs === "number" && Number.isFinite(obs) ? obs : null,
    crypto: input.periodsPerYear === 365,
    ...(unreadable ? { unreadable: true as const } : {}),
  };
}

/**
 * Does the TOTAL record clear D-15's minimum? Crypto: span >= 90 days. Non-crypto:
 * observations >= 60; while the count is absent, span >= 90 days (A-194-D15-02, the
 * failure direction is the dash). Null when the deciding input is null. False for an
 * `unreadable` record (a present but malformed date), whatever its count.
 */
export function recordClears(record: FigureRecord): boolean | null {
  if (record.unreadable) return false;
  if (!record.crypto && record.observations != null) {
    return record.observations >= MIN_ANNUALIZATION_OBS;
  }
  if (record.spanDays == null) return null;
  return record.spanDays >= MIN_ANNUALIZATION_DAYS;
}

/**
 * The state of an annualised figure. `windowSpanDays` is the span of the figures shown
 * (a selected range, blend overlap, half, rolling window); omitted, it is the record's
 * own span (full history); `null` is an unknown window. The window only qualifies a
 * figure (short or full); it never withholds one.
 */
export function gateAnnualized(record: FigureRecord, windowSpanDays?: number | null): FigureState {
  const clears = recordClears(record);
  if (clears === false) return "withheld";
  if (clears === null) return "null";
  const window = windowSpanDays === undefined ? record.spanDays : windowSpanDays;
  if (window == null || !Number.isFinite(window)) return "null";
  return window < ONE_YEAR_DAYS ? "short" : "full";
}

/** The annualised figure keys every surface gates (volatility is stored as `volatility` or `ann_vol`). */
export const ANNUALIZED_KEYS = ["cagr", "volatility", "ann_vol", "sharpe", "sortino", "calmar"] as const;

/** `null` for a withheld state or a non-finite value; the value otherwise. Never a substitute number. */
export function gatedValue(value: number | null | undefined, state: FigureState): number | null {
  if (state === "withheld") return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// --- D-11 widened kinds: shared span helpers and verdicts ----------------------
// 194 D-11 as superseded by D-15 (2026-11-07). Every widened kind (deltas and lifts,
// alpha / tracking error / information ratio / Treynor, rolling charts, half-record
// figures) is withheld on the TOTAL record only, through `recordClears`; the window it
// covers only qualifies the note, through `gateAnnualized`. No helper restates 60, 90 or
// 365, and none looks at a figure's size (D-05).

/**
 * 194 D-11 (2026-11-07): the shortest of several windows' spans, in covered days. Null when
 * no span is given or any is null, undefined or non-finite (an unknown window stays unknown).
 */
export function shorterSpan(...spans: Array<number | null | undefined>): number | null {
  if (spans.length === 0) return null;
  let min = Infinity;
  for (const s of spans) {
    if (typeof s !== "number" || !Number.isFinite(s)) return null;
    if (s < min) min = s;
  }
  return min;
}

/**
 * 194 D-11 / D-15 (2026-11-07): the state of a delta or lift between two records. Withheld
 * when EITHER record fails the total-record gate; null when either is undeterminable (the
 * figure stays, no note); otherwise short or full from the COMPARED window
 * (`shorterSpan` of the two windows). A short compared window never withholds.
 */
export function gateDelta(a: FigureRecord, b: FigureRecord, comparedSpanDays: number | null): FigureState {
  const clearsA = recordClears(a);
  const clearsB = recordClears(b);
  if (clearsA === false || clearsB === false) return "withheld";
  if (clearsA === null || clearsB === null) return "null";
  return gateAnnualized(a, comparedSpanDays);
}

/**
 * 194 D-11 (2026-11-07), A-194-D11-01: the span a row window covers, in covered days (D-20:
 * first to last return date, both counted), taken as the SHORTEST over every full window (the
 * D-04 record rule applied to the window). Null when the window is under 2 rows or the
 * record holds fewer dates than the window.
 */
export function rollingWindowSpanDays(dates: readonly string[], window: number): number | null {
  if (!Number.isFinite(window) || window < 2 || dates.length < window) return null;
  let min = Infinity;
  for (let i = window - 1; i < dates.length; i++) {
    const s = coveredDays(dates[i - window + 1], dates[i]);
    if (!Number.isFinite(s)) return null;
    if (s < min) min = s;
  }
  return min;
}

/** A rolling window: a count of return rows, or (D-14) a calendar length that shows plain once filled. */
export type RollingWindowSpec = { rows: number } | { calendarDays: number };

/**
 * `cause` is `gate` when the total record fails the gate (the shared record reason),
 * `record` when it clears but holds no full window (nothing to draw), null otherwise.
 */
export interface RollingVerdict {
  state: FigureState;
  days: number | null;
  cause: "gate" | "record" | null;
}

/**
 * 194 D-11 / D-14 / D-15 (2026-11-07), A-194-D15-01: the verdict for a rolling chart. In
 * order: a record failing the gate is withheld with cause `gate`; a record with no full
 * window (fewer than two dates, `enough` false, fewer dates than a row window, or a span
 * under a calendar window) is withheld with cause `record`, because there is no series to
 * draw; otherwise short or full from `gateAnnualized` over the window's span. A calendar
 * window that is filled spans its own length.
 */
export function gateRollingWindow(
  record: FigureRecord,
  dates: readonly string[],
  window: RollingWindowSpec,
  enough: boolean,
): RollingVerdict {
  if (recordClears(record) === false) {
    return { state: "withheld", days: record.spanDays, cause: "gate" };
  }
  const noWindow: RollingVerdict = { state: "withheld", days: record.spanDays ?? 0, cause: "record" };
  if (dates.length < 2 || !enough) return noWindow;
  if ("rows" in window) {
    const span = rollingWindowSpanDays(dates, window.rows);
    if (span === null) return noWindow;
    return { state: gateAnnualized(record, span), days: span, cause: null };
  }
  if (record.spanDays == null || record.spanDays < window.calendarDays) return noWindow;
  return { state: gateAnnualized(record, window.calendarDays), days: window.calendarDays, cause: null };
}

// --- Copy (the revised UI-SPEC "Copywriting Contract", verbatim) --------------

function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function plural(n: number, one: string, many: string): string {
  return Math.round(n) === 1 ? one : many;
}
function days(n: number): string {
  return `${count(n)} ${plural(n, "day", "days")}`;
}

/** Which bound decided a withhold: the observation count (non-crypto with a stored count) or the day span. */
function decidedByObservations(record: FigureRecord): boolean {
  return !record.crypto && record.observations != null;
}

export const SHORT_TRACK_MARKER = "<1y";

export const VAR_METHOD_LINE =
  "VaR and CVaR are historical and 1-day: VaR is the loss exceeded on 5% of days in the record, CVaR the average loss on those days.";

/** The panel-level reason line when the TOTAL record fails D-15's minimum. */
export function withheldReason(scope: "record" | "blend", record: FigureRecord): string {
  const blend = scope === "blend";
  if (record.unreadable) {
    return `Annualized figures are not shown: ${blend ? "the blend's" : "this record's"} dates could not be read.`;
  }
  if (decidedByObservations(record)) {
    const n = record.observations ?? 0;
    return blend
      ? `Annualized figures appear once the blend's overlapping record reaches ${MIN_ANNUALIZATION_OBS} trading days. It has ${count(n)} trading ${plural(n, "day", "days")}.`
      : `Annualized figures appear once the record reaches ${MIN_ANNUALIZATION_OBS} trading days. This record has ${count(n)} trading ${plural(n, "day", "days")}.`;
  }
  const n = record.spanDays ?? 0;
  return blend
    ? `Annualized figures appear once the blend's overlapping record reaches ${MIN_ANNUALIZATION_DAYS} days. It covers ${days(n)}.`
    : `Annualized figures appear once the record reaches ${MIN_ANNUALIZATION_DAYS} days. This record covers ${days(n)}.`;
}

/** The cell `title` / sr-only text for a withheld figure in a list or Holdings. */
export function withheldCellTitle(record: FigureRecord): string {
  if (record.unreadable) return "Withheld: the record's dates could not be read.";
  if (decidedByObservations(record)) {
    return `Withheld until the record reaches ${MIN_ANNUALIZATION_OBS} trading days (${count(record.observations ?? 0)} so far).`;
  }
  return `Withheld until the record reaches ${MIN_ANNUALIZATION_DAYS} days (${days(record.spanDays ?? 0)} so far).`;
}

/** The one muted note when a cleared record's window is under one year. */
export function shortTrackNote(scope: "record" | "range" | "blend", n: number): string {
  const tail =
    scope === "blend"
      ? `${days(n)} of overlapping record`
      : scope === "range"
        ? `${days(n)} of the selected range`
        : `${days(n)} of record`;
  return `CAGR, volatility, Sharpe, Sortino and Calmar are annualized from ${tail}, under one year.`;
}

/** The `<1y` marker's `title` / sr-only text. */
export function shortTrackMarkerTitle(n: number): string {
  return `Annualized from ${days(n)} of record, under one year.`;
}

/**
 * 194.2 D-05 (194-ZOOM-BENCHMARK-COVERAGE): the one muted sentence naming the span a benchmark
 * was actually compared over when a selected range is wider than its data. `from` and `through`
 * arrive ALREADY FORMATTED ("Mar 3, 2026"): the formatter lives in the factsheet rail, which
 * imports this module, so this module must not import it back. `sides` says which end of the
 * window the benchmark's data falls short of (judged on the benchmark's own calendar by
 * `startsAfterCoverage` / `isPastCoverage` in factsheet/align.ts). Neither side short: null,
 * there is nothing to say. No call site concatenates this sentence, so a test can pin every form.
 */
export function benchCoverageNote(
  benchmarkName: string,
  from: string,
  through: string,
  sides: { startsAfter: boolean; endsBefore: boolean },
): string | null {
  if (!sides.startsAfter && !sides.endsBefore) return null;
  const why = sides.startsAfter && sides.endsBefore ? "starts after and ends before" : sides.startsAfter ? "starts after" : "ends before";
  const span = from === through ? `on ${from} only` : `over ${from} – ${through}`;
  return `${benchmarkName} compared ${span} (its data ${why} this range).`;
}

/** The `title` of a 6 Month / 3 Month cell that is null because the record does not cover the window. */
export function windowNeedsTitle(window: "6m" | "3m"): string {
  return window === "6m"
    ? `6 Month needs ${SIX_MONTH_WINDOW_DAYS} days of record.`
    : `3 Month needs ${THREE_MONTH_WINDOW_DAYS} days of record.`;
}

/** The list's "Not shown" line; null when nothing was excluded (the line is hidden at 0). */
export function notShownLine(n: number, metricLabels: readonly string[]): string | null {
  if (n <= 0 || metricLabels.length === 0) return null;
  const head = metricLabels.slice(0, -1);
  const last = metricLabels[metricLabels.length - 1];
  const names = head.length === 0 ? last : `${head.join(", ")} or ${last}`;
  return `Not shown: ${count(n)} ${plural(n, "strategy", "strategies")} with no figure for ${names}.`;
}

// --- D-11 copy (A-194-D11-02: new wording in the UI-SPEC idiom) ---------------

/**
 * The one record-bound clause for a widened withhold: the bound that decided (`90 days` or
 * `60 trading days`), the verb the record's count takes, and the count itself. Built from
 * the same constants and formatter as `withheldReason`, so no number is restated.
 */
function recordBoundClause(record: FigureRecord): { bound: string; verb: "covers" | "has"; held: string } {
  if (decidedByObservations(record)) {
    const n = record.observations ?? 0;
    return {
      bound: `${MIN_ANNUALIZATION_OBS} trading days`,
      verb: "has",
      held: `${count(n)} trading ${plural(n, "day", "days")}`,
    };
  }
  return { bound: `${MIN_ANNUALIZATION_DAYS} days`, verb: "covers", held: days(record.spanDays ?? 0) };
}

export type WidenedKind = "delta" | "overlap" | "rolling" | "rolling-record" | "half";

const WIDENED_SUBJECT: Record<Exclude<WidenedKind, "rolling-record">, string> = {
  delta: "Changes in annualized figures",
  overlap: "Alpha, information ratio, Treynor and tracking error",
  rolling: "Rolling annualized figures",
  half: "Half-record annualized figures",
};

/**
 * 194 D-11 / D-15 (2026-11-07): the reason line when a widened kind is withheld. `record` is
 * the TOTAL record that failed (for a delta, the shorter of the two); its asset class picks
 * the wording. A withheld sentence names the deciding bound and the record's own count,
 * never a window, range or overlap length.
 */
export function widenedWithheldReason(kind: WidenedKind, record: FigureRecord): string {
  if (record.unreadable) {
    const subject = kind === "rolling-record" ? "Rolling annualized figures" : WIDENED_SUBJECT[kind];
    return `${subject} are not shown: the record's dates could not be read.`;
  }
  if (kind === "rolling-record") {
    return `Rolling annualized figures appear once the record covers one full rolling window. This record covers ${days(record.spanDays ?? 0)}.`;
  }
  const { bound, verb, held } = recordBoundClause(record);
  if (kind === "delta") {
    return `${WIDENED_SUBJECT.delta} appear once both records reach ${bound}. The shorter ${verb} ${held}.`;
  }
  return `${WIDENED_SUBJECT[kind]} appear once the record reaches ${bound}. This record ${verb} ${held}.`;
}

/** 194 D-11 (2026-11-07): the one muted note when a cleared record's widened-kind window is under one year. */
export function widenedShortNote(kind: Exclude<WidenedKind, "rolling-record">, n: number): string {
  switch (kind) {
    case "delta":
      return `${WIDENED_SUBJECT.delta} are measured over ${days(n)}, under one year.`;
    case "overlap":
      return `${WIDENED_SUBJECT.overlap} are annualized from ${days(n)} of overlap, under one year.`;
    case "rolling":
      return `Rolling figures are annualized from a ${count(n)}-day window, under one year.`;
    case "half":
      return `Half-record figures are annualized from ${days(n)}, under one year.`;
  }
}
