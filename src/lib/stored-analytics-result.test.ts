import { describe, it, expect } from "vitest";
import {
  LAST_SUCCESS_SNAPSHOT_KEY,
  effectiveDataQualityFlags,
  hasStoredAnalyticsResult,
  hasUnboundDerivePrestamp,
  isSameInstant,
  storedEntryCount,
  usesLastSuccessSnapshot,
} from "./stored-analytics-result";

/**
 * Phase 190 plan 03. WHY these rules exist (Rule 9): a strategy re-computing over
 * a stored success result keeps its factsheet, but ONLY numbers a finished run
 * wrote may be shown, beside the flags that same run wrote. Every case below is
 * one way the three evidence checks or the snapshot binding could let a number
 * through next to another run's flags, or hide a number that is safe to show.
 */

const AT = "2026-08-25T09:15:00.000Z";
const SERIES = [
  { date: "2025-08-01", value: 0.01 },
  { date: "2025-08-02", value: -0.02 },
];

/** A row that passes all three checks; each test breaks exactly one. */
function fullRow(over: Record<string, unknown> = {}) {
  return {
    daily_returns: SERIES,
    returns_series: null,
    cumulative_return: 0.05,
    computed_at: AT,
    data_quality_flags: { cumulative_method: "geometric" },
    ...over,
  };
}

/** A derive prestamp carrying a snapshot of the last success's flags. */
function prestampRow(snapshot: unknown, over: Record<string, unknown> = {}) {
  return fullRow({
    data_quality_flags: { csv_source: true, [LAST_SUCCESS_SNAPSHOT_KEY]: snapshot },
    ...over,
  });
}

const BOUND_SNAPSHOT = { computed_at: AT, flags: { cumulative_method: "simple", small_base_measured: true } };

describe("storedEntryCount (moved verbatim from fetch-and-build-payload)", () => {
  it("counts array entries by distinct date plus each dateless entry", () => {
    expect(storedEntryCount([{ date: "a" }, { date: "a" }, { date: "b" }])).toBe(2);
    expect(storedEntryCount([{ value: 1 }, { value: 2 }])).toBe(2);
  });
  it("counts a flat dict's keys and a nested dict's inner keys", () => {
    expect(storedEntryCount({ "2025-01-01": 1, "2025-01-02": 2 })).toBe(2);
    expect(storedEntryCount({ "2025": { "01-01": 1, "01-02": 2 }, "2026": { "01-01": 3 } })).toBe(3);
  });
  it("holds none for null, a scalar or an empty container", () => {
    expect(storedEntryCount(null)).toBe(0);
    expect(storedEntryCount(undefined)).toBe(0);
    expect(storedEntryCount("x")).toBe(0);
    expect(storedEntryCount([])).toBe(0);
    expect(storedEntryCount({})).toBe(0);
  });
});

describe("isSameInstant", () => {
  it("compares instants, not text: Postgres and JS spellings of one moment are equal", () => {
    expect(isSameInstant("2026-08-25T10:00:00.123456+00:00", "2026-08-25T10:00:00.123Z")).toBe(true);
  });
  it("is false one second apart", () => {
    expect(isSameInstant("2026-08-25T10:00:00Z", "2026-08-25T10:00:01Z")).toBe(false);
  });
  it("fails closed on a non-string or an unparseable value", () => {
    expect(isSameInstant(null, null)).toBe(false);
    expect(isSameInstant(undefined, AT)).toBe(false);
    expect(isSameInstant(AT, 12345)).toBe(false);
    expect(isSameInstant("not a date", "not a date")).toBe(false);
  });
});

describe("hasStoredAnalyticsResult — all three checks, each alone false makes the whole false", () => {
  it("control: the full row passes", () => {
    expect(hasStoredAnalyticsResult(fullRow())).toBe(true);
  });

  it("is false for a null or undefined row", () => {
    expect(hasStoredAnalyticsResult(null)).toBe(false);
    expect(hasStoredAnalyticsResult(undefined)).toBe(false);
  });

  describe("(a) a stored series", () => {
    it("fails with no series at all (a first-ever compute)", () => {
      expect(hasStoredAnalyticsResult(fullRow({ daily_returns: null, returns_series: null }))).toBe(false);
      expect(hasStoredAnalyticsResult(fullRow({ daily_returns: [], returns_series: [] }))).toBe(false);
    });
    it("counts daily_returns as an array, a flat dict and a nested dict", () => {
      expect(hasStoredAnalyticsResult(fullRow({ daily_returns: { "2025-01-01": 0.01 } }))).toBe(true);
      expect(hasStoredAnalyticsResult(fullRow({ daily_returns: { "2025": { "01-01": 0.01 } } }))).toBe(true);
    });
    it("counts a returns_series array", () => {
      expect(hasStoredAnalyticsResult(fullRow({ daily_returns: null, returns_series: SERIES }))).toBe(true);
    });
    it("counts the series_end alias of the ranked list", () => {
      expect(
        hasStoredAnalyticsResult(fullRow({ daily_returns: undefined, returns_series: undefined, series_end: "2025-08-02" })),
      ).toBe(true);
      expect(
        hasStoredAnalyticsResult(fullRow({ daily_returns: undefined, returns_series: undefined, series_end: "" })),
      ).toBe(false);
    });
  });

  describe("(b) a finite stored headline", () => {
    it.each([
      ["null", null],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["a string", "0.05"],
      ["undefined", undefined],
    ])("fails when cumulative_return is %s", (_label, value) => {
      expect(hasStoredAnalyticsResult(fullRow({ cumulative_return: value }))).toBe(false);
    });
    it("accepts zero and a negative number", () => {
      expect(hasStoredAnalyticsResult(fullRow({ cumulative_return: 0 }))).toBe(true);
      expect(hasStoredAnalyticsResult(fullRow({ cumulative_return: -0.4 }))).toBe(true);
    });
  });

  describe("(c) success-written flags", () => {
    it("fails when the flags lack cumulative_method (a csv_source-only failure arm or prestamp)", () => {
      expect(hasStoredAnalyticsResult(fullRow({ data_quality_flags: { csv_source: true } }))).toBe(false);
      expect(hasStoredAnalyticsResult(fullRow({ data_quality_flags: {} }))).toBe(false);
      expect(hasStoredAnalyticsResult(fullRow({ data_quality_flags: null }))).toBe(false);
    });
    it("fails when the marker is empty or not a string", () => {
      expect(hasStoredAnalyticsResult(fullRow({ data_quality_flags: { cumulative_method: "" } }))).toBe(false);
      expect(hasStoredAnalyticsResult(fullRow({ data_quality_flags: { cumulative_method: 3 } }))).toBe(false);
    });
    it("fails when the flags are an array", () => {
      expect(hasStoredAnalyticsResult(fullRow({ data_quality_flags: [{ cumulative_method: "geometric" }] }))).toBe(false);
    });
    it("counts the cumulative_method alias when the blob is not shipped", () => {
      expect(
        hasStoredAnalyticsResult(fullRow({ data_quality_flags: undefined, cumulative_method: "geometric" })),
      ).toBe(true);
      expect(hasStoredAnalyticsResult(fullRow({ data_quality_flags: undefined }))).toBe(false);
    });
  });
});

describe("effectiveDataQualityFlags — the flags that belong to the stored numbers", () => {
  it("live flags with a top-level marker win even when a snapshot is present", () => {
    const row = fullRow({
      data_quality_flags: { cumulative_method: "geometric", [LAST_SUCCESS_SNAPSHOT_KEY]: BOUND_SNAPSHOT },
    });
    const eff = effectiveDataQualityFlags(row);
    expect(eff.source).toBe("live");
    expect(eff.flags?.cumulative_method).toBe("geometric");
  });

  it("live flags without the marker plus a snapshot bound to the row's computed_at give the snapshot's flags", () => {
    const row = prestampRow(BOUND_SNAPSHOT);
    const eff = effectiveDataQualityFlags(row);
    expect(eff.source).toBe("snapshot");
    expect(eff.flags).toEqual(BOUND_SNAPSHOT.flags);
    expect(eff.live?.csv_source).toBe(true);
    expect(hasStoredAnalyticsResult(row)).toBe(true);
  });

  it("binds the same instant written in two formats", () => {
    const row = prestampRow(
      { computed_at: "2026-08-25T10:00:00.123456+00:00", flags: { cumulative_method: "geometric" } },
      { computed_at: "2026-08-25T10:00:00.123Z" },
    );
    expect(effectiveDataQualityFlags(row).source).toBe("snapshot");
  });

  it.each([
    ["one second off", { computed_at: "2026-08-25T09:15:01.000Z", flags: { cumulative_method: "simple" } }],
    ["missing computed_at", { flags: { cumulative_method: "simple" } }],
    ["a non-string computed_at", { computed_at: 1787652000123, flags: { cumulative_method: "simple" } }],
    ["an unparseable computed_at", { computed_at: "nope", flags: { cumulative_method: "simple" } }],
    ["flags without the marker", { computed_at: AT, flags: { small_base_measured: true } }],
    ["flags as an array", { computed_at: AT, flags: [{ cumulative_method: "simple" }] }],
    ["no flags", { computed_at: AT }],
    ["a null value (plan 09 had no snapshot)", null],
    ["an array", [BOUND_SNAPSHOT]],
    ["a string", "snapshot"],
  ])("never uses a snapshot with %s", (_label, snapshot) => {
    const row = prestampRow(snapshot);
    const eff = effectiveDataQualityFlags(row);
    expect(eff.source).toBe("live");
    expect(eff.flags).toEqual(row.data_quality_flags);
    expect(hasStoredAnalyticsResult(row)).toBe(false);
  });

  it("never binds when the row's computed_at is null", () => {
    const row = prestampRow(BOUND_SNAPSHOT, { computed_at: null });
    expect(effectiveDataQualityFlags(row).source).toBe("live");
  });

  it("answers live flags null for a null row, a null blob and an array blob", () => {
    expect(effectiveDataQualityFlags(null).flags).toBeNull();
    expect(effectiveDataQualityFlags(undefined).flags).toBeNull();
    expect(effectiveDataQualityFlags({ data_quality_flags: null }).flags).toBeNull();
    expect(effectiveDataQualityFlags({ data_quality_flags: [] }).flags).toBeNull();
  });
});

describe("last-success aliases (a projection that does not ship the flags blob)", () => {
  const aliasRow = (over: Record<string, unknown>) =>
    fullRow({ data_quality_flags: undefined, computed_at: AT, ...over });

  it("a last_success_cumulative_method bound to the row's computed_at satisfies (c)", () => {
    const row = aliasRow({ last_success_cumulative_method: "geometric", last_success_computed_at: AT });
    expect(hasStoredAnalyticsResult(row)).toBe(true);
    expect(usesLastSuccessSnapshot(row)).toBe(true);
  });
  it("an unbound one does not", () => {
    const row = aliasRow({
      last_success_cumulative_method: "geometric",
      last_success_computed_at: "2026-08-25T09:15:05.000Z",
    });
    expect(hasStoredAnalyticsResult(row)).toBe(false);
    expect(usesLastSuccessSnapshot(row)).toBe(false);
  });
  it("an empty alias does not", () => {
    const row = aliasRow({ last_success_cumulative_method: "", last_success_computed_at: AT });
    expect(hasStoredAnalyticsResult(row)).toBe(false);
  });
});

describe("usesLastSuccessSnapshot — true only when (c) rests on a snapshot", () => {
  it("is true for a bound snapshot in the blob", () => {
    expect(usesLastSuccessSnapshot(prestampRow(BOUND_SNAPSHOT))).toBe(true);
  });
  it("is false when the live flags carry the marker, with or without a snapshot", () => {
    expect(usesLastSuccessSnapshot(fullRow())).toBe(false);
    expect(
      usesLastSuccessSnapshot(
        fullRow({ data_quality_flags: { cumulative_method: "geometric", [LAST_SUCCESS_SNAPSHOT_KEY]: BOUND_SNAPSHOT } }),
      ),
    ).toBe(false);
  });
  it("is false when the cumulative_method alias carries the marker", () => {
    expect(usesLastSuccessSnapshot(fullRow({ data_quality_flags: undefined, cumulative_method: "geometric" }))).toBe(false);
  });
  it("is false for an unbound snapshot, a null snapshot and a null row", () => {
    expect(usesLastSuccessSnapshot(prestampRow({ ...BOUND_SNAPSHOT, computed_at: "2020-01-01T00:00:00Z" }))).toBe(false);
    expect(usesLastSuccessSnapshot(prestampRow(null))).toBe(false);
    expect(usesLastSuccessSnapshot(null)).toBe(false);
  });
});

describe("LAST_SUCCESS_SNAPSHOT_KEY", () => {
  it("is the key plan 09's derive hop writes", () => {
    expect(LAST_SUCCESS_SNAPSHOT_KEY).toBe("last_success_snapshot");
  });
});

/**
 * Phase 190 D-04 (founder 2026-11-03). WHY: the status bridge keeps a warned
 * row's terminal status while the derive hop replaces its flags, so without this
 * state the factsheet would draw the last success's figures under the new run's
 * warnings. The founder chose the queued state over that mix. The key (not the
 * missing marker) is the evidence: a legacy row computed before the marker
 * existed lacks the marker at rest too, and must not vanish.
 */
describe("hasUnboundDerivePrestamp — a derive prestamp with no snapshot the reader may use", () => {
  const prestamp = (snapshot: unknown, over: Record<string, unknown> = {}) =>
    fullRow({
      data_quality_flags: { csv_source: true, twr_chain_broken: true, [LAST_SUCCESS_SNAPSHOT_KEY]: snapshot },
      ...over,
    });

  it("is true for a prestamp whose snapshot key is null (plan 09 had no snapshot)", () => {
    expect(hasUnboundDerivePrestamp(prestamp(null))).toBe(true);
  });
  it("is true for a snapshot one second off the row's computed_at (a raced success)", () => {
    expect(
      hasUnboundDerivePrestamp(
        prestamp({ computed_at: "2026-08-25T09:15:01.000Z", flags: { cumulative_method: "geometric" } }),
      ),
    ).toBe(true);
  });
  it("is true for a snapshot whose flags lack cumulative_method", () => {
    expect(hasUnboundDerivePrestamp(prestamp({ computed_at: AT, flags: { csv_source: true } }))).toBe(true);
  });
  it("is false when the live flags carry the top-level marker, with or without a snapshot key", () => {
    expect(hasUnboundDerivePrestamp(fullRow())).toBe(false);
    expect(
      hasUnboundDerivePrestamp(
        fullRow({ data_quality_flags: { cumulative_method: "geometric", [LAST_SUCCESS_SNAPSHOT_KEY]: null } }),
      ),
    ).toBe(false);
    // A composite stitch carries a stale key forward and also writes the marker.
    expect(
      hasUnboundDerivePrestamp(
        fullRow({
          data_quality_flags: {
            cumulative_method: "geometric",
            [LAST_SUCCESS_SNAPSHOT_KEY]: { computed_at: "2020-01-01T00:00:00Z", flags: {} },
          },
        }),
      ),
    ).toBe(false);
  });
  it("is false when the key is absent (a legacy row at rest, or a prestamp from code older than plan 09)", () => {
    expect(hasUnboundDerivePrestamp(fullRow({ data_quality_flags: { csv_source: true } }))).toBe(false);
    expect(hasUnboundDerivePrestamp(fullRow({ data_quality_flags: {} }))).toBe(false);
  });
  it("is false when the snapshot is bound", () => {
    expect(hasUnboundDerivePrestamp(prestamp(BOUND_SNAPSHOT))).toBe(false);
  });
  it("is false for a null or undefined row, null or array flags, and an alias-only projection", () => {
    expect(hasUnboundDerivePrestamp(null)).toBe(false);
    expect(hasUnboundDerivePrestamp(undefined)).toBe(false);
    expect(hasUnboundDerivePrestamp(fullRow({ data_quality_flags: null }))).toBe(false);
    expect(hasUnboundDerivePrestamp(fullRow({ data_quality_flags: [LAST_SUCCESS_SNAPSHOT_KEY] }))).toBe(false);
    expect(hasUnboundDerivePrestamp(fullRow({ data_quality_flags: undefined, cumulative_method: "geometric" }))).toBe(false);
  });
});
