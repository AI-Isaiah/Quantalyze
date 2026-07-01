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

/**
 * The WINDOW-06 "name the outlier(s)" source: given a map of
 * `{strategyId → CoverageSpan}`, return the id(s) whose removal restores a
 * non-null common intersection over the remaining spans — the strategy(ies)
 * breaking the overlap that the empty-intersection banner names for a one-click
 * "deselect {X}" fix.
 *
 * Contract:
 *   - If the whole set already intersects (`intersectionOf !== null`), returns
 *     `[]` — there is a common window, no outlier. Empty map and single-strategy
 *     map also return `[]` (a single span always intersects itself).
 *   - Otherwise it PEELS greedily until the remainder intersects. Each step the
 *     empty overlap is bounded by exactly two spans — the one with the MAXIMUM
 *     `first` (latest start) and the one with the MINIMUM `last` (earliest end).
 *     Dropping anything else cannot move either offending bound, so only those
 *     two are removal candidates. The step removes whichever candidate most
 *     CLOSES the `max(first) − min(last)` gap over the remainder (the smaller
 *     resulting gap wins); it accumulates that id and repeats. This peels one
 *     span per step and provably terminates: each removal strictly shrinks the
 *     set, and once `remaining.size === 1` (or the remainder intersects) it
 *     stops. The returned set is the accumulated removals.
 *   - Deterministic tie-break when both candidate removals yield the SAME
 *     resulting gap: prefer removing the id with the latest `first` (the
 *     strategy that starts after everyone else's data ends); if the firsts also
 *     tie, prefer removing the earliest `last`. Ties are broken by id key order
 *     as a final deterministic backstop.
 *
 * REMOVAL-RESTORES-OVERLAP invariant (T-57-02): after removing EVERY returned id
 * the remainder yields a non-null `intersectionOf` (or is a single span, which
 * always intersects itself) — proven in the tests, including the 3+ and 4
 * mutually-disjoint cells that the earlier two-candidate implementation silently
 * violated. The intersection math is NOT re-derived here; it delegates to
 * `intersectionOf`, with an inline `boundsOf` closure comparing the candidate
 * remainders' [start, end] pairs (lexicographic strings can't be subtracted).
 * Pure: the input map is never mutated, string compare only, no JS Date.
 */
export function outlierIdsFor(
  spansById: Record<string, CoverageSpan>,
): string[] {
  const allIds = Object.keys(spansById);
  if (allIds.length <= 1) return [];
  if (intersectionOf(allIds.map((id) => spansById[id])) !== null) return [];

  // The signed gap max(first) − min(last) over a set: > "" (positive-ish, i.e.
  // start > end) means empty overlap; <= means a real window. Because these are
  // lexicographic "YYYY-MM-DD" strings we cannot subtract — instead we compare
  // the resulting [start, end] pairs directly to decide which removal closes the
  // overlap more. Returns the {start, end} bound pair for a remaining id set.
  const boundsOf = (
    remaining: string[],
  ): { start: string; end: string } => {
    let start = spansById[remaining[0]].first;
    let end = spansById[remaining[0]].last;
    for (let i = 1; i < remaining.length; i++) {
      const sp = spansById[remaining[i]];
      if (sp.first > start) start = sp.first;
      if (sp.last < end) end = sp.last;
    }
    return { start, end };
  };

  // Peel greedily. Work on a mutable COPY of the id list (never the input map).
  const remaining = [...allIds];
  const removed: string[] = [];

  while (
    remaining.length > 1 &&
    intersectionOf(remaining.map((id) => spansById[id])) === null
  ) {
    // The two bounding candidates: latest `first`, earliest `last`.
    let maxFirstId = remaining[0];
    let minLastId = remaining[0];
    for (const id of remaining) {
      if (spansById[id].first > spansById[maxFirstId].first) maxFirstId = id;
      if (spansById[id].last < spansById[minLastId].last) minLastId = id;
    }

    let pick: string;
    if (maxFirstId === minLastId) {
      // A single span pins BOTH bounds — remove it.
      pick = maxFirstId;
    } else {
      const boundsWithoutMaxFirst = boundsOf(
        remaining.filter((id) => id !== maxFirstId),
      );
      const boundsWithoutMinLast = boundsOf(
        remaining.filter((id) => id !== minLastId),
      );
      // The resulting overlap "gap" is start − end: the SMALLER (more negative)
      // the better closed. Compare the two candidate remainders' bound pairs by
      // their (start, end) so the removal that pulls start earliest / end latest
      // wins. Lower start wins first; on a start tie, higher end wins.
      const removeMaxFirstIsBetter =
        boundsWithoutMaxFirst.start < boundsWithoutMinLast.start ||
        (boundsWithoutMaxFirst.start === boundsWithoutMinLast.start &&
          boundsWithoutMaxFirst.end >= boundsWithoutMinLast.end);
      // Tie-break: prefer removing the latest-`first` strategy (maxFirstId).
      pick = removeMaxFirstIsBetter ? maxFirstId : minLastId;
    }

    removed.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }

  return removed;
}
