import { describe, it, expect } from "vitest";
import {
  coverageSpanOf,
  intersectionOf,
  defaultWindowFor,
  covers,
  unionOf,
} from "./scenario-window";
import type { DailyPoint } from "./portfolio-math-utils";

/**
 * Boundary-cell unit tests for the coverage-window primitives (BLEND-02).
 *
 * WHY these cases exist (Rule 9 — tests encode intent, not just behavior):
 *
 *   - Coverage MUST come from the returns array ONLY, never from the
 *     `"2022-01-01"` sentinel or `start_date` metadata (Pitfall 2). A span
 *     sourced from metadata would mislabel a ragged-head strategy as a
 *     blend member and re-introduce the tail-dilution this milestone kills.
 *   - Membership containment is INCLUSIVE-CLOSED `[winStart, winEnd]`
 *     (Pitfall 1). The whole point of the coverage window is that an
 *     ended strategy stops being a member; a `<` vs `<=` off-by-one silently
 *     admits or drops the wrong strategy, so the four boundary cells around
 *     each bound are load-bearing, not decorative.
 *   - An empty intersection MUST yield null, never a fabricated window
 *     (`no-invented-data` — Pitfall 4 upstream). A synthesized window would
 *     let the engine emit a plausible-looking flat-zero blend for a set of
 *     strategies that never co-existed.
 */

function series(dates: string[]): DailyPoint[] {
  // value is irrelevant to span derivation — coverage is date presence only.
  return dates.map((date) => ({ date, value: 0.001 }));
}

describe("coverageSpanOf", () => {
  it("returns null for an empty series (no data → no span)", () => {
    expect(coverageSpanOf([])).toBeNull();
  });

  it("first === last for a single-entry series", () => {
    expect(coverageSpanOf(series(["2023-05-10"]))).toEqual({
      first: "2023-05-10",
      last: "2023-05-10",
    });
  });

  it("reports the first date WITH data, ignoring any earlier sentinel (leading gap)", () => {
    // Data does not begin until 2023-03-01. The span's `first` must be the
    // real first data day — NOT the "2022-01-01" sentinel that predates it.
    const span = coverageSpanOf(
      series(["2023-03-01", "2023-03-02", "2023-03-03"]),
    );
    expect(span).not.toBeNull();
    expect(span!.first).toBe("2023-03-01");
  });

  it("reports the last date WITH data (trailing gap → span ends where data ends)", () => {
    const span = coverageSpanOf(
      series(["2024-06-28", "2024-06-29", "2024-06-30"]),
    );
    expect(span).not.toBeNull();
    expect(span!.last).toBe("2024-06-30");
  });

  it("derives min/max from unsorted input (does NOT rely on a pre-sort)", () => {
    const span = coverageSpanOf(
      series(["2023-07-15", "2023-01-04", "2023-11-30", "2023-03-22"]),
    );
    expect(span).toEqual({ first: "2023-01-04", last: "2023-11-30" });
  });
});

describe("covers (inclusive-closed containment)", () => {
  const span = { first: "2023-01-01", last: "2024-01-01" };

  it("covers a window whose bounds EXACTLY equal the span (exact-boundary member)", () => {
    expect(covers(span, { start: "2023-01-01", end: "2024-01-01" })).toBe(true);
  });

  it("does NOT cover a window that starts one day BEFORE the span (span starts late)", () => {
    expect(covers(span, { start: "2022-12-31", end: "2024-01-01" })).toBe(
      false,
    );
  });

  it("covers a window that starts one day AFTER the span start", () => {
    expect(covers(span, { start: "2023-01-02", end: "2024-01-01" })).toBe(true);
  });

  it("does NOT cover a window that ends one day AFTER the span (span ends early)", () => {
    expect(covers(span, { start: "2023-01-01", end: "2024-01-02" })).toBe(
      false,
    );
  });

  it("covers a window that ends one day BEFORE the span end", () => {
    expect(covers(span, { start: "2023-01-01", end: "2023-12-31" })).toBe(true);
  });
});

describe("intersectionOf / defaultWindowFor (latest-start … earliest-end)", () => {
  it("intersects two overlapping spans to [max(firsts), min(lasts)]", () => {
    const spans = [
      { first: "2023-01-01", last: "2024-06-01" },
      { first: "2023-04-01", last: "2024-03-01" },
    ];
    expect(intersectionOf(spans)).toEqual({
      start: "2023-04-01",
      end: "2024-03-01",
    });
  });

  it("defaultWindowFor delegates to the SAME intersection math (single implementation)", () => {
    const spans = [
      { first: "2023-01-01", last: "2024-06-01" },
      { first: "2023-04-01", last: "2024-03-01" },
    ];
    expect(defaultWindowFor(spans)).toEqual(intersectionOf(spans));
  });

  it("returns null (NOT a fabricated window) when the spans do not overlap", () => {
    // latest-start (2024-01-01) is AFTER earliest-end (2023-06-01) → empty.
    const spans = [
      { first: "2023-01-01", last: "2023-06-01" },
      { first: "2024-01-01", last: "2024-06-01" },
    ];
    expect(intersectionOf(spans)).toBeNull();
    expect(defaultWindowFor(spans)).toBeNull();
  });

  it("returns null for an empty span set (no members → no window)", () => {
    expect(intersectionOf([])).toBeNull();
    expect(defaultWindowFor([])).toBeNull();
  });

  it("returns the span itself for a single-member set", () => {
    const spans = [{ first: "2023-02-01", last: "2023-09-01" }];
    expect(intersectionOf(spans)).toEqual({
      start: "2023-02-01",
      end: "2023-09-01",
    });
  });

  it("touching-at-a-point spans intersect to a single-day window (inclusive-closed)", () => {
    // earliest-end === latest-start → a degenerate but VALID single-day window,
    // not null. Inclusive-closed math must accept start === end.
    const spans = [
      { first: "2023-01-01", last: "2023-06-15" },
      { first: "2023-06-15", last: "2023-12-31" },
    ];
    expect(intersectionOf(spans)).toEqual({
      start: "2023-06-15",
      end: "2023-06-15",
    });
  });
});

describe("unionOf (earliest-start … latest-end — the 'Full range' preset target)", () => {
  /**
   * WHY (Rule 9): `unionOf` is the WINDOW-05 "Full range (some drop out)" preset
   * target. It is the MIRROR of `intersectionOf` — the widest bounds `[min(firsts),
   * max(lasts)]` — and, crucially, it NEVER returns null for a non-empty set: the
   * union of even fully-disjoint intervals is a single spanning window. Members that
   * fall outside that window are dropped DOWNSTREAM by `covers`, not by this helper.
   * If a `<` vs `>` or a JS-Date compare crept in here, the preset would snap to the
   * wrong span and either over- or under-widen the blend window.
   */

  it("returns null for an empty span set (mirrors intersectionOf empty case)", () => {
    expect(unionOf([])).toBeNull();
  });

  it("returns the span itself (as a window) for a single-member set", () => {
    expect(unionOf([{ first: "2023-01-01", last: "2023-06-30" }])).toEqual({
      start: "2023-01-01",
      end: "2023-06-30",
    });
  });

  it("widens two overlapping spans to [min(firsts), max(lasts)]", () => {
    const spans = [
      { first: "2023-01-01", last: "2023-06-30" },
      { first: "2023-03-01", last: "2023-12-31" },
    ];
    expect(unionOf(spans)).toEqual({
      start: "2023-01-01",
      end: "2023-12-31",
    });
  });

  it("returns a single spanning window for FULLY-DISJOINT spans (never null for a non-empty set)", () => {
    // The union of disjoint intervals is [earliest first, latest last] — the gap
    // between them is irrelevant to the widest bounds. `covers` drops the members
    // that do not span this window later; unionOf itself never returns null here.
    const spans = [
      { first: "2023-01-01", last: "2023-06-30" },
      { first: "2024-06-01", last: "2024-12-31" },
    ];
    expect(unionOf(spans)).toEqual({
      start: "2023-01-01",
      end: "2024-12-31",
    });
  });

  it("does NOT mutate its input array or its span objects", () => {
    const spans = [
      { first: "2023-03-01", last: "2023-09-01" },
      { first: "2023-01-01", last: "2023-12-31" },
    ];
    const snapshot = JSON.parse(JSON.stringify(spans));
    unionOf(spans);
    expect(spans).toEqual(snapshot);
  });
});
