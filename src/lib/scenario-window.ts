/**
 * scenario-window — coverage-span + intersection primitives for the v1.5
 * coverage-window blend (ADR-001, BLEND-02).
 *
 * The SINGLE source of truth for deriving a scenario's blend window. The
 * `computeScenario` coverage path (55-02), the BLEND-07 gate (55-03), and the
 * composer / share-resolve / compare consumers (Phases 57/59) all import these
 * functions so the window is derived IDENTICALLY everywhere. Defining the
 * contracts here — interface-first, with boundary-cell tests — locks two
 * invariants before any engine code depends on them:
 *
 *   1. INCLUSIVE-CLOSED containment (Pitfall 1). The blend window is the closed
 *      interval `[winStart, winEnd]`; a strategy is a member iff
 *      `span.first <= winStart && span.last >= winEnd`. A `<` vs `<=` off-by-one
 *      silently admits or drops the wrong strategy. This mirrors the
 *      additive-field doc-comment discipline of `scenario.ts` (`leverage?`,
 *      :68-82) — the invariant is pinned in prose and in tests.
 *
 *   2. Coverage is derived from the RETURNS ARRAY ONLY (Pitfall 2). A span is
 *      `[first date WITH data, last date WITH data]` — never the legacy
 *      pre-data sentinel, never `start_date` metadata. Sourcing a span from
 *      metadata would mislabel a ragged-head strategy as a member and
 *      re-introduce the tail-dilution this milestone kills.
 *
 * Zero new dependencies. All interval math is LEXICOGRAPHIC "YYYY-MM-DD" string
 * comparison (the `dateday.ts` convention) — never JS date objects, which
 * reintroduce the UTC/local off-by-one `dateday.ts` exists to eliminate. Inputs
 * are never mutated; no I/O.
 */

import type { DailyPoint } from "./portfolio-math-utils";

/** A strategy's data coverage: the first and last calendar day WITH data. */
export interface CoverageSpan {
  first: string;
  last: string;
}

/** A closed blend window `[start, end]`. */
export interface CoverageWindow {
  start: string;
  end: string;
}

/**
 * The coverage span of a returns series: `[first date WITH data, last date WITH
 * data]`, derived by min/max over the entries' dates via lexicographic string
 * compare. Leading/trailing absence is IGNORED — a series that begins on
 * 2023-03-01 reports `first === "2023-03-01"`, never any earlier sentinel
 * (Pitfall 2). Does NOT assume the input is pre-sorted; scans defensively.
 * Returns `null` for an empty series (no data → no span).
 */
export function coverageSpanOf(dailyReturns: DailyPoint[]): CoverageSpan | null {
  if (dailyReturns.length === 0) return null;
  let first = dailyReturns[0].date;
  let last = dailyReturns[0].date;
  for (let i = 1; i < dailyReturns.length; i++) {
    const d = dailyReturns[i].date;
    if (d < first) first = d;
    if (d > last) last = d;
  }
  return { first, last };
}

/**
 * The intersection of a set of coverage spans: `[max(firsts), min(lasts)]` by
 * lexicographic compare — the latest start and the earliest end common to
 * every span. Returns `null` when the set is empty OR the intersection is empty
 * (`start > end`) — a non-overlapping set yields NO window, never a fabricated
 * one (`no-invented-data`). A single-day intersection (`start === end`, spans
 * touching at a point) is a VALID closed window, not null.
 */
export function intersectionOf(spans: CoverageSpan[]): CoverageWindow | null {
  if (spans.length === 0) return null;
  let start = spans[0].first;
  let end = spans[0].last;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].first > start) start = spans[i].first;
    if (spans[i].last < end) end = spans[i].last;
  }
  if (start > end) return null;
  return { start, end };
}

/**
 * The union of a set of coverage spans: `[min(firsts), max(lasts)]` by
 * lexicographic compare — the earliest start and the latest end across every
 * span. This is the mirror of `intersectionOf` (opposite direction) and the
 * "Full range (some drop out)" preset target (WINDOW-05): the widest window the
 * selected set can span. Returns `null` ONLY when the set is empty — a non-empty
 * union ALWAYS has a valid window (unlike intersection, there is no `start > end`
 * degenerate: `min(firsts) <= max(lasts)` always holds for a non-empty set, even
 * for fully-disjoint spans). Members that do not cover this widened window are
 * dropped DOWNSTREAM by `covers`, never by this helper — `unionOf` reports the
 * bounds; membership is a separate step.
 */
export function unionOf(spans: CoverageSpan[]): CoverageWindow | null {
  if (spans.length === 0) return null;
  let start = spans[0].first;
  let end = spans[0].last;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].first < start) start = spans[i].first;
    if (spans[i].last > end) end = spans[i].last;
  }
  return { start, end };
}

/**
 * The default blend window for a set of selected+enabled strategy spans: the
 * intersection (latest-start … earliest-end). Delegates to `intersectionOf` —
 * ONE implementation of the intersection math. Returns `null` on an empty
 * intersection (no common window) rather than a synthesized window.
 */
export function defaultWindowFor(spans: CoverageSpan[]): CoverageWindow | null {
  return intersectionOf(spans);
}

/**
 * INCLUSIVE-CLOSED containment: does `span` cover the closed window
 * `[window.start, window.end]`? True iff `span.first <= window.start &&
 * span.last >= window.end` — the strategy has data on or before the window
 * start AND on or after the window end. This is the BLEND-02 membership test
 * (Pitfall 1): an ended strategy whose `last` falls before `window.end` is NOT
 * a member and no longer dilutes the blend divisor.
 */
export function covers(span: CoverageSpan, window: CoverageWindow): boolean {
  return span.first <= window.start && span.last >= window.end;
}
