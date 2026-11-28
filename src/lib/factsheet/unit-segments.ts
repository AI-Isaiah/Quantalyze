/**
 * Phase 256 OKXUNITSWITCH plan 05 — the ONE parser of a unit switch and the ONE
 * composer of every sentence that names it.
 *
 * An OKX account can move from a USDT-margined book into a coin-margined one, so
 * its record is USD up to a day S and a coin (BTC, ETH, ...) from S+1. The derive
 * stores that as `data_quality_flags.unit_switch` (the small marker) and
 * `strategy_analytics.unit_segments` (the two native series). This module reads
 * both at the boundary and composes the copy; the factsheet, the strategy list
 * and the share card import from here so none of them can disagree.
 *
 * Isomorphic and React-free. A malformed value reads as ABSENT, never partially:
 * the surface then renders as a plain USD strategy, which is today's render, and
 * nothing in it is guessed (the `parseReturnsUnit` posture).
 *
 * Every template takes the units and the days as parameters. Days print only
 * through `formatCloseDay` (the app-wide Phase 201 U-14 format), and no unit or
 * date is a literal in this file.
 */

import { formatCloseDay, formatUnpricedDays, parseIsoDay, parseReturnsUnit } from "./returns-unit";

const DAY_MS = 86_400_000;

/** The stable unit of the first segment. It is the only value `fromUnit` ever takes. */
const FROM_UNIT = "USD" as const;

/**
 * The parsed `data_quality_flags.unit_switch`. `lastFromDay` is the last USD
 * return day (S) and `firstToDay` is the first coin return day (S+1), two days
 * the derive recorded, never one `switch_day` the reader would have to guess at.
 */
export interface UnitSwitchView {
  fromUnit: typeof FROM_UNIT;
  toUnit: string;
  lastFromDay: string;
  firstToDay: string;
}

/** One native return point of a stored segment. */
export interface UnitSegmentPoint {
  date: string;
  value: number;
}

/** The parsed `strategy_analytics.unit_segments`: both native series, each in its own unit. */
export interface UnitSegmentsView {
  fromReturns: UnitSegmentPoint[];
  toReturns: UnitSegmentPoint[];
  baseDay: string;
  /** Days the BTC (coin) close is missing for. Only that cause: see `withheldDays`. */
  unpricedDays: string[];
  /**
   * Days the USD figures leave out although a close exists: mixed days of the move with no
   * stored USD value, and coin days the stored series has no point for (R3-06). Absent in a
   * record written before the field existed, which reads as none.
   */
  withheldDays: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse an untrusted `unit_switch` flag. The coin must pass `RETURNS_UNIT_RE`
 * and not be USD, both days must be real calendar days, and the first coin day
 * must be exactly one UTC day after the last USD day. Anything else is null.
 */
export function parseUnitSwitch(raw: unknown): UnitSwitchView | null {
  if (!isRecord(raw)) return null;
  const coin = parseReturnsUnit(raw.coin);
  if (coin === null || coin === FROM_UNIT) return null;
  const last = raw.last_usd_day;
  const first = raw.first_coin_return_day;
  if (typeof last !== "string" || typeof first !== "string") return null;
  const lastMs = parseIsoDay(last);
  const firstMs = parseIsoDay(first);
  if (lastMs === null || firstMs === null) return null;
  if (firstMs - lastMs !== DAY_MS) return null;
  return { fromUnit: FROM_UNIT, toUnit: coin, lastFromDay: last, firstToDay: first };
}

/** A finite number, so a JSON `null` or a string never reaches a compounded figure. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * The return points of one stored segment: strictly ascending real days with a
 * finite value each. Null on any deviation, so a half-readable series is not drawn.
 */
function parsePoints(raw: unknown): UnitSegmentPoint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: UnitSegmentPoint[] = [];
  let prev = -Infinity;
  for (const p of raw) {
    if (!isRecord(p)) return null;
    const { date, value } = p;
    if (typeof date !== "string" || !isFiniteNumber(value)) return null;
    const t = parseIsoDay(date);
    if (t === null || t <= prev) return null;
    prev = t;
    out.push({ date, value });
  }
  return out;
}

/**
 * Parse an untrusted `unit_segments` sidecar against the already-parsed switch.
 * The USD segment must end on `lastFromDay`, the coin segment must be based on
 * `lastFromDay` and begin on `firstToDay`, and no point may sit on the wrong side
 * of the boundary. A version other than 1, a non-object, a missing segment or a
 * non-finite value is null.
 */
export function parseUnitSegments(raw: unknown, sw: UnitSwitchView): UnitSegmentsView | null {
  if (!isRecord(raw) || raw.version !== 1) return null;
  const segments = raw.segments;
  if (!Array.isArray(segments) || segments.length !== 2) return null;
  const [from, to] = segments as unknown[];
  if (!isRecord(from) || !isRecord(to)) return null;
  if (from.unit !== sw.fromUnit || from.to_day !== sw.lastFromDay) return null;
  if (typeof from.from_day !== "string" || parseIsoDay(from.from_day) === null) return null;
  if (to.unit !== sw.toUnit) return null;
  if (to.base_day !== sw.lastFromDay || to.from_day !== sw.firstToDay) return null;
  if (typeof to.to_day !== "string" || parseIsoDay(to.to_day) === null) return null;

  const fromReturns = parsePoints(from.returns);
  const toReturns = parsePoints(to.returns);
  // A switched strategy always has a USD segment; the coin segment may hold only its base.
  if (fromReturns === null || fromReturns.length === 0 || toReturns === null) return null;
  if (fromReturns[fromReturns.length - 1].date > sw.lastFromDay) return null;
  if (toReturns.length > 0 && toReturns[0].date < sw.firstToDay) return null;

  const unpricedDays = parseDayList(raw.unpriced_days);
  if (unpricedDays === null) return null;
  const withheldDays = raw.withheld_days === undefined ? [] : parseDayList(raw.withheld_days);
  if (withheldDays === null) return null;
  return {
    fromReturns,
    toReturns,
    baseDay: to.base_day,
    unpricedDays,
    withheldDays,
  };
}

/** A list of real calendar days, de-duplicated and ascending, so a count is a count of distinct days. */
function parseDayList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const days = new Set<string>();
  for (const d of raw) {
    if (typeof d !== "string" || parseIsoDay(d) === null) return null;
    days.add(d);
  }
  return [...days].sort();
}

/** `In USD to <day>, in BTC from <day>`: the frame every surface repeats, from the derived days. */
export function composeUnitSwitchSentence(sw: UnitSwitchView): string {
  return `In ${sw.fromUnit} to ${formatCloseDay(sw.lastFromDay)}, in ${sw.toUnit} from ${formatCloseDay(sw.firstToDay)}`;
}

/** Masthead line 1. */
export function unitSwitchMastheadLine(sw: UnitSwitchView): string {
  return `${composeUnitSwitchSentence(sw)}.`;
}

/** The headline KPI block's note: the figures stay whole-record USD, the coin part converted. */
export function unitSwitchKpiNote(sw: UnitSwitchView): string {
  return (
    `${composeUnitSwitchSentence(sw)}. These figures cover the whole record in ${sw.fromUnit}, ` +
    `with the ${sw.toUnit} part converted at the stored daily ${sw.toUnit} close.`
  );
}

/**
 * Masthead line 2: every coin-segment day the USD figures leave out, for want of a stored
 * close. `day`/`days` and `that day`/`those days` agree with the count. Empty when none.
 */
export function unitSwitchUnpricedNote(sw: UnitSwitchView, days: readonly string[]): string {
  const m = days.length;
  if (m === 0) return "";
  return (
    `No ${sw.toUnit} close for ${m} ${m === 1 ? "day" : "days"}: ${formatUnpricedDays(days)}. ` +
    `The ${sw.fromUnit} figures leave ${m === 1 ? "that day" : "those days"} out.`
  );
}

/**
 * Masthead line 3 (R3-06): the days the USD figures leave out although a close exists, for want of a
 * stored USD value around the move into the coin. Worded apart from the no-close note, because the
 * cause is not a missing close. Empty when none.
 */
export function unitSwitchWithheldNote(sw: UnitSwitchView, days: readonly string[]): string {
  const m = days.length;
  if (m === 0) return "";
  return (
    `No stored ${sw.fromUnit} value for ${m} ${m === 1 ? "day" : "days"} around the move into ${sw.toUnit}: ` +
    `${formatUnpricedDays(days)}. The ${sw.fromUnit} figures leave ${m === 1 ? "that day" : "those days"} out.`
  );
}

/**
 * Masthead line 2 when the stored segments did not read (absent, malformed, or a different
 * derive than the switch flag): the unpriced days are then unknown, so say that rather than
 * show a single USD line that reads as "nothing left out".
 */
export function unitSwitchSegmentsUnavailableNote(sw: UnitSwitchView): string {
  return `The ${sw.fromUnit} and ${sw.toUnit} lines and any days with no ${sw.toUnit} close are not available for this record.`;
}

/** The Cumulative Returns figcaption. The comparator clause only when a comparator is drawn. */
export function unitSwitchFigcaption(sw: UnitSwitchView, opts: { comparatorActive: boolean }): string {
  const base =
    `${composeUnitSwitchSentence(sw)}. The two parts are separate lines: the ${sw.toUnit} part starts again at 1.00× ` +
    `and is not chained to the ${sw.fromUnit} part.`;
  return opts.comparatorActive ? `${base} The comparator is shown to ${formatCloseDay(sw.lastFromDay)}.` : base;
}

/** The figcaption when the coin segment holds only its base. */
export function unitSwitchBaseOnlyFigcaption(sw: UnitSwitchView): string {
  return `${composeUnitSwitchSentence(sw)}. No ${sw.toUnit} day is in the record yet.`;
}

/** The compact list chip's visible text. */
export function unitSwitchChipText(sw: UnitSwitchView): string {
  return `${sw.fromUnit}, then ${sw.toUnit}`;
}

/** The compact list chip's `title`. */
export function unitSwitchChipTitle(sw: UnitSwitchView): string {
  return (
    `${composeUnitSwitchSentence(sw)}. Figures on this row are in ${sw.fromUnit}, ` +
    `with the ${sw.toUnit} part converted at the stored daily ${sw.toUnit} close.`
  );
}

/** The reason line under the held leverage control. */
export function unitSwitchLeverageReason(sw: UnitSwitchView): string {
  return (
    `Leverage is off for this strategy: its ${sw.fromUnit} figures include a part converted from ${sw.toUnit}, ` +
    `so leverage would also lever ${sw.toUnit}.`
  );
}

/** The share card's note line. */
export function unitSwitchOgNote(sw: UnitSwitchView): string {
  return `${composeUnitSwitchSentence(sw)}. Figures in ${sw.fromUnit}.`;
}
