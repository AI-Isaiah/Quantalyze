import { describe, it, expect } from "vitest";
import { analyticsHold, HELD_RERUN_CACHE_CONTROL, type HoldRow } from "./analytics-hold";

/**
 * Phase 237 FACT-02 — the boundary table of the held-re-run verdict. Each case
 * names the factsheet refusal it mirrors, so a change to the resolve stage in
 * fetch-and-build-payload.ts has a test here that must move with it.
 */

const COMPUTED_AT = "2026-11-20T10:00:00.000Z";
const SERIES = [{ date: "2026-11-01", value: 0.01 }];

/** A row that stores a success result: a one-entry series, a finite headline, a success marker. */
function stored(over: Record<string, unknown> = {}): NonNullable<HoldRow> {
  return {
    daily_returns: SERIES,
    cumulative_return: 0,
    computed_at: COMPUTED_AT,
    data_quality_flags: { cumulative_method: "geometric" },
    ...over,
  };
}

describe("analyticsHold — terminal rows", () => {
  it.each(["complete", "complete_with_warnings"])(
    "%s with no prestamp is admitted and not updating",
    (computation_status) => {
      expect(analyticsHold(stored({ computation_status }))).toEqual({ updating: false, admitted: true });
    },
  );

  it("a terminal row with no stored evidence at all is still admitted (it is a terminal success)", () => {
    expect(analyticsHold({ computation_status: "complete" })).toEqual({ updating: false, admitted: true });
  });
});

describe("analyticsHold — held re-run (isRecomputeOverStoredResult)", () => {
  it.each(["pending", "computing"])(
    "%s over a one-entry series, cumulative_return 0 and a live marker is updating and admitted",
    (computation_status) => {
      // One entry counts as a series, and 0 counts as a finite headline.
      expect(analyticsHold(stored({ computation_status }))).toEqual({ updating: true, admitted: true });
    },
  );

  it("the series_end alias alone satisfies the series check", () => {
    const row = stored({
      computation_status: "computing",
      daily_returns: undefined,
      series_end: "2026-11-01",
    });
    expect(analyticsHold(row)).toEqual({ updating: true, admitted: true });
  });

  it("a snapshot-bound marker holds as well as a live marker", () => {
    const row = stored({
      computation_status: "computing",
      data_quality_flags: {
        last_success_snapshot: { computed_at: COMPUTED_AT, flags: { cumulative_method: "geometric" } },
      },
    });
    expect(analyticsHold(row)).toEqual({ updating: true, admitted: true });
  });

  it.each([
    ["no series", { daily_returns: null, returns_series: null }],
    ["an empty series", { daily_returns: [], returns_series: {} }],
    ["cumulative_return NaN", { cumulative_return: Number.NaN }],
    ["cumulative_return missing", { cumulative_return: undefined }],
    ["no success marker", { data_quality_flags: {} }],
  ])("pending with %s is neither updating nor admitted", (_name, over) => {
    expect(analyticsHold(stored({ computation_status: "pending", ...over }))).toEqual({
      updating: false,
      admitted: false,
    });
  });

  it("a computing composite over a stored result is not held (the factsheet withholds it)", () => {
    const row = stored({
      computation_status: "computing",
      data_quality_flags: { cumulative_method: "geometric", composite: true },
    });
    expect(analyticsHold(row)).toEqual({ updating: false, admitted: false });
  });

  it("a computing row whose live flags are a prestamp reads composite from the BOUND snapshot, not the prestamp", () => {
    const row = stored({
      computation_status: "computing",
      data_quality_flags: {
        composite: true, // the prestamp's flags: must not decide
        last_success_snapshot: { computed_at: COMPUTED_AT, flags: { cumulative_method: "geometric" } },
      },
    });
    expect(analyticsHold(row)).toEqual({ updating: true, admitted: true });
  });
});

describe("analyticsHold — adjacency edge: a failed row is never admitted", () => {
  it.each(["failed", "failed_final"])("%s with full stored evidence is not admitted", (computation_status) => {
    expect(analyticsHold(stored({ computation_status }))).toEqual({ updating: false, admitted: false });
  });
});

describe("analyticsHold — D-04 derive prestamp on a terminal row", () => {
  const unbound = { last_success_snapshot: null };

  it("a complete row whose live flags carry the snapshot key and no bound snapshot is not admitted", () => {
    const row = stored({ computation_status: "complete", data_quality_flags: unbound });
    expect(analyticsHold(row)).toEqual({ updating: false, admitted: false });
  });

  it("the same row with a snapshot bound to its computed_at is admitted", () => {
    const row = stored({
      computation_status: "complete",
      data_quality_flags: {
        last_success_snapshot: { computed_at: COMPUTED_AT, flags: { cumulative_method: "geometric" } },
      },
    });
    expect(analyticsHold(row)).toEqual({ updating: false, admitted: true });
  });

  it("a snapshot bound to a DIFFERENT computed_at stays unbound and withholds", () => {
    const row = stored({
      computation_status: "complete",
      data_quality_flags: {
        last_success_snapshot: { computed_at: "2026-11-19T10:00:00.000Z", flags: { cumulative_method: "geometric" } },
      },
    });
    expect(analyticsHold(row)).toEqual({ updating: false, admitted: false });
  });
});

describe("analyticsHold — empty edge", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a row with no computation_status", { daily_returns: SERIES, cumulative_return: 1 }],
    ["a non-string status", { computation_status: 7, daily_returns: SERIES, cumulative_return: 1 }],
    ["a pending row with an empty series", { computation_status: "pending", daily_returns: [] }],
  ])("%s answers both false", (_name, row) => {
    expect(analyticsHold(row as HoldRow)).toEqual({ updating: false, admitted: false });
  });
});

describe("HELD_RERUN_CACHE_CONTROL", () => {
  it("is a short public cache with no stale-while-revalidate", () => {
    expect(HELD_RERUN_CACHE_CONTROL).toBe("public, max-age=60, s-maxage=60");
    expect(HELD_RERUN_CACHE_CONTROL).not.toContain("stale-while-revalidate");
  });
});
