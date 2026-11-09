import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CLOCK_SKEW_TOLERANCE_MINUTES,
  TRADE_FETCH_STALE_DAYS,
  TRADE_FETCH_VENUES,
  computeFreshness,
  resolveTradeFetch,
  freshnessLabel,
  freshnessTooltip,
  FRESHNESS_COLORS,
  FRESH_HOURS,
  WARM_HOURS,
  SERIES_STALE_DAYS,
  SERIES_STALE_DAYS_TRADITIONAL,
  listSeriesVerdict,
} from "./freshness";

describe("computeFreshness", () => {
  // Reference "now" so tests are deterministic regardless of wall clock.
  const NOW = new Date("2026-04-08T12:00:00.000Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

  describe("null/undefined/unparseable inputs", () => {
    it("returns stale for null", () => {
      expect(computeFreshness(null, NOW)).toBe("stale");
    });
    it("returns stale for undefined", () => {
      expect(computeFreshness(undefined, NOW)).toBe("stale");
    });
    it("returns stale for unparseable strings", () => {
      expect(computeFreshness("not a date", NOW)).toBe("stale");
    });
    it("returns stale for NaN", () => {
      expect(computeFreshness(NaN, NOW)).toBe("stale");
    });
  });

  describe("fresh boundary (< 12h)", () => {
    it("returns fresh for just-now", () => {
      expect(computeFreshness(NOW, NOW)).toBe("fresh");
    });
    it("returns fresh for 6 hours ago", () => {
      expect(computeFreshness(hoursAgo(6), NOW)).toBe("fresh");
    });
    it("returns fresh just inside the 12h boundary", () => {
      expect(computeFreshness(hoursAgo(FRESH_HOURS - 0.1), NOW)).toBe("fresh");
    });
    it("tolerates small future skew (<5 min) as fresh", () => {
      const future = new Date(NOW.getTime() + 2 * 60 * 1000); // 2 min ahead
      expect(computeFreshness(future, NOW)).toBe("fresh");
    });
  });

  describe("clock skew handling", () => {
    it("returns stale for future timestamps beyond the skew tolerance", () => {
      // 1 hour in the future is well beyond the 5-minute tolerance.
      // Treating these as 'fresh' would mask analytics writer bugs and
      // staging-data leaks where someone wrote now() + interval '1 day'.
      const future = new Date(NOW.getTime() + 60 * 60 * 1000);
      expect(computeFreshness(future, NOW)).toBe("stale");
    });
    it("returns stale for far-future timestamps (e.g. year 2050)", () => {
      const future = new Date("2050-01-01");
      expect(computeFreshness(future, NOW)).toBe("stale");
    });
  });

  describe("warm boundary (12h ≤ x < 48h)", () => {
    it("flips to warm at exactly 12 hours", () => {
      expect(computeFreshness(hoursAgo(FRESH_HOURS), NOW)).toBe("warm");
    });
    it("returns warm for 24 hours ago", () => {
      expect(computeFreshness(hoursAgo(24), NOW)).toBe("warm");
    });
    it("returns warm just inside the 48h boundary", () => {
      expect(computeFreshness(hoursAgo(WARM_HOURS - 0.1), NOW)).toBe("warm");
    });
  });

  describe("stale boundary (≥ 48h)", () => {
    it("flips to stale at exactly 48 hours", () => {
      expect(computeFreshness(hoursAgo(WARM_HOURS), NOW)).toBe("stale");
    });
    it("returns stale for 72 hours ago", () => {
      expect(computeFreshness(hoursAgo(72), NOW)).toBe("stale");
    });
    it("returns stale for ancient timestamps", () => {
      expect(computeFreshness(new Date("2020-01-01"), NOW)).toBe("stale");
    });
  });

  describe("input shapes", () => {
    it("accepts Date objects", () => {
      expect(computeFreshness(hoursAgo(1), NOW)).toBe("fresh");
    });
    it("accepts unix-ms numbers", () => {
      expect(computeFreshness(hoursAgo(1).getTime(), NOW)).toBe("fresh");
    });
    it("accepts ISO strings", () => {
      expect(computeFreshness(hoursAgo(1).toISOString(), NOW)).toBe("fresh");
    });
  });
});

describe("freshnessLabel", () => {
  it("maps fresh", () => {
    expect(freshnessLabel("fresh")).toBe("Fresh");
  });
  it("maps warm", () => {
    expect(freshnessLabel("warm")).toBe("Warm");
  });
  it("maps stale", () => {
    expect(freshnessLabel("stale")).toBe("Stale");
  });
});

describe("freshnessTooltip", () => {
  it("references the 12h fresh threshold", () => {
    expect(freshnessTooltip("fresh")).toContain(`${FRESH_HOURS} hours`);
  });
  it("references both thresholds for warm", () => {
    const text = freshnessTooltip("warm");
    expect(text).toContain(`${FRESH_HOURS}`);
    expect(text).toContain(`${WARM_HOURS}`);
  });
  it("references the 48h stale threshold", () => {
    expect(freshnessTooltip("stale")).toContain(`${WARM_HOURS} hours`);
  });
});

describe("FRESHNESS_COLORS", () => {
  it("has dot + badge classes for every state", () => {
    for (const key of ["fresh", "warm", "stale"] as const) {
      expect(FRESHNESS_COLORS[key].dot).toBeTruthy();
      expect(FRESHNESS_COLORS[key].badge).toBeTruthy();
    }
  });
});

// ── Phase 167.1.2.2.2 / TRADESYNC (D-05, D-07): the trade-fetch classifier ──
describe("resolveTradeFetch", () => {
  const NOW = new Date("2026-10-10T12:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports the D-05 threshold as 2 days and the three fetched venues", () => {
    expect(TRADE_FETCH_STALE_DAYS).toBe(2);
    expect([...TRADE_FETCH_VENUES]).toEqual(["okx", "bybit", "binance"]);
  });

  describe("D-05 boundary: more than 2 days is strict greater-than on elapsed ms", () => {
    it("exactly 48 h old is current", () => {
      const fetched = at(-TRADE_FETCH_STALE_DAYS * DAY_MS);
      expect(resolveTradeFetch(fetched, "okx", NOW)).toEqual({
        state: "current",
        fetchedAt: fetched,
      });
    });
    it("48 h plus 1 ms is stale", () => {
      const fetched = at(-TRADE_FETCH_STALE_DAYS * DAY_MS - 1);
      expect(resolveTradeFetch(fetched, "okx", NOW).state).toBe("stale");
    });
    it("a 9 day old fetch is stale and carries that exact instant", () => {
      const fetched = at(-9 * DAY_MS);
      const r = resolveTradeFetch(fetched, "bybit", NOW);
      expect(r.state).toBe("stale");
      expect(r.fetchedAt?.getTime()).toBe(fetched.getTime());
    });
    it("a 1 h old fetch is current (the daily tick is not the 12 h ladder)", () => {
      // A 20 h old fetch would be `warm` on computeFreshness; it must stay
      // current here or a daily tick reads amber for half of every day.
      expect(computeFreshness(at(-20 * 60 * 60 * 1000), NOW)).toBe("warm");
      expect(resolveTradeFetch(at(-20 * 60 * 60 * 1000), "okx", NOW).state).toBe(
        "current",
      );
    });
  });

  describe("T-167.1.2.2.2-27: a corrupt future timestamp is never current", () => {
    const tolMs = CLOCK_SKEW_TOLERANCE_MINUTES * 60 * 1000;
    it("exactly the skew tolerance ahead is current", () => {
      expect(resolveTradeFetch(at(tolMs), "okx", NOW).state).toBe("current");
    });
    it("one ms beyond the skew tolerance is future", () => {
      const fetched = at(tolMs + 1);
      expect(resolveTradeFetch(fetched, "okx", NOW)).toEqual({
        state: "future",
        fetchedAt: fetched,
      });
    });
    it("a year-2050 write is future", () => {
      expect(resolveTradeFetch("2050-01-01T00:00:00Z", "okx", NOW).state).toBe(
        "future",
      );
    });
  });

  describe("unparseable input", () => {
    it("is not_applicable and warns once across two calls with the same bad value", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const bad = "not-a-date-once";
      const a = resolveTradeFetch(bad, "okx", NOW);
      const b = resolveTradeFetch(bad, "okx", NOW);
      expect(a).toEqual({ state: "not_applicable", fetchedAt: null });
      expect(b).toEqual({ state: "not_applicable", fetchedAt: null });
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("null timestamp: the venue separates never from not_applicable", () => {
    it.each(["okx", "OKX", "bybit", "binance"])("%s -> never", (venue) => {
      expect(resolveTradeFetch(null, venue, NOW)).toEqual({
        state: "never",
        fetchedAt: null,
      });
    });
    it.each(["deribit", "mt5", "sfox", "csv", null, undefined, ""])(
      "%s -> not_applicable",
      (venue) => {
        expect(resolveTradeFetch(null, venue, NOW)).toEqual({
          state: "not_applicable",
          fetchedAt: null,
        });
      },
    );
  });

  describe("a non-null fetch is authoritative whatever the venue says", () => {
    it.each([null, "csv", "mt5", "deribit"])(
      "NOW - 1h with venue %s -> current",
      (venue) => {
        expect(resolveTradeFetch(at(-60 * 60 * 1000), venue, NOW).state).toBe(
          "current",
        );
      },
    );
    it("a stale non-null fetch is stale even with a null venue", () => {
      expect(resolveTradeFetch(at(-5 * DAY_MS), null, NOW).state).toBe("stale");
    });
  });

  describe("input shapes", () => {
    it("accepts ISO strings and unix-ms numbers", () => {
      const fetched = at(-60 * 60 * 1000);
      expect(resolveTradeFetch(fetched.toISOString(), "okx", NOW).state).toBe(
        "current",
      );
      expect(resolveTradeFetch(fetched.getTime(), "okx", NOW).state).toBe(
        "current",
      );
    });
  });
});

/**
 * Phase 197 / CLAR-02 (D-03) - the list verdict. It exists so a strategy whose return series ended
 * weeks ago cannot rank as current, and it must read the newest return DAY, never a pipeline instant.
 * The boundaries are asserted on the constants' values AND by name, so moving a threshold without
 * moving its copy goes red.
 */
describe("listSeriesVerdict (Phase 197 D-03)", () => {
  const NOW_MS = Date.parse("2026-11-08T12:00:00.000Z");
  const dayAgo = (n: number) =>
    new Date(NOW_MS - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  it("pins the two thresholds the copy interpolates", () => {
    expect(SERIES_STALE_DAYS).toBe(7);
    expect(SERIES_STALE_DAYS_TRADITIONAL).toBe(10);
  });

  it("crypto: 7 whole days old is current, 8 is stale", () => {
    expect(listSeriesVerdict(dayAgo(7), "crypto", NOW_MS)).toEqual({
      verdict: "current",
      ageDays: 7,
      thresholdDays: SERIES_STALE_DAYS,
    });
    expect(listSeriesVerdict(dayAgo(8), "crypto", NOW_MS)).toEqual({
      verdict: "stale",
      ageDays: 8,
      thresholdDays: SERIES_STALE_DAYS,
    });
  });

  it("traditional: 10 whole days old is current, 11 is stale", () => {
    expect(listSeriesVerdict(dayAgo(10), "traditional", NOW_MS)).toEqual({
      verdict: "current",
      ageDays: 10,
      thresholdDays: SERIES_STALE_DAYS_TRADITIONAL,
    });
    expect(listSeriesVerdict(dayAgo(11), "traditional", NOW_MS).verdict).toBe("stale");
  });

  it("a null or unrecognised asset class takes the traditional threshold, not the crypto one", () => {
    // 9 days old: stale for crypto (>7), current for everything else (<=10).
    expect(listSeriesVerdict(dayAgo(9), null, NOW_MS).verdict).toBe("current");
    expect(listSeriesVerdict(dayAgo(9), undefined, NOW_MS).thresholdDays).toBe(10);
    expect(listSeriesVerdict(dayAgo(9), "CRYPTO", NOW_MS).verdict).toBe("current");
    expect(listSeriesVerdict(dayAgo(9), "crypto", NOW_MS).verdict).toBe("stale");
    expect(listSeriesVerdict(dayAgo(11), null, NOW_MS).verdict).toBe("stale");
  });

  it("counts whole UTC days: the same bar reads the same at 00:30 and 23:30", () => {
    const end = dayAgo(7);
    const early = Date.parse("2026-11-08T00:30:00.000Z");
    const late = Date.parse("2026-11-08T23:30:00.000Z");
    expect(listSeriesVerdict(end, "crypto", early).verdict).toBe("current");
    expect(listSeriesVerdict(end, "crypto", late).verdict).toBe("current");
    // One UTC midnight later the same bar is 8 whole days old.
    expect(listSeriesVerdict(end, "crypto", Date.parse("2026-11-09T00:00:00.000Z")).verdict).toBe("stale");
  });

  it("accepts a full ISO timestamp by its first ten characters", () => {
    expect(listSeriesVerdict(`${dayAgo(30)}T00:00:00Z`, "crypto", NOW_MS).ageDays).toBe(30);
  });

  it("missing or unparseable series_end is unknown, never current", () => {
    for (const bad of [null, undefined, "", "not a day", "2026-13-45", "2026/11/01", "11-08-2026"]) {
      expect(listSeriesVerdict(bad, "crypto", NOW_MS)).toEqual({
        verdict: "unknown",
        ageDays: null,
        thresholdDays: SERIES_STALE_DAYS,
      });
    }
  });

  it("a non-finite instant cannot be judged", () => {
    expect(listSeriesVerdict(dayAgo(1), "crypto", NaN).verdict).toBe("unknown");
  });

  it("a date within the 2-day skew tolerance is current: one day ahead (timezone skew, RESEARCH A3)", () => {
    expect(listSeriesVerdict(dayAgo(-1), "crypto", NOW_MS).verdict).toBe("current");
  });

  it("a date more than 2 whole UTC days ahead is unknown, never current: a dead strategy must not rank as current", () => {
    for (const end of [dayAgo(-3), "2099-01-01"]) {
      expect(listSeriesVerdict(end, "crypto", NOW_MS)).toEqual({
        verdict: "unknown",
        ageDays: null,
        thresholdDays: SERIES_STALE_DAYS,
      });
    }
    expect(listSeriesVerdict("2099-01-01", "traditional", NOW_MS).verdict).toBe("unknown");
  });

  it("a calendar-impossible day is unknown, not rolled over to the next month", () => {
    // Date.parse("2026-02-31T00:00:00Z") is 2026-03-03 in V8: only a round-trip check refuses it.
    for (const bad of ["2026-02-31", "2026-04-31", "2025-02-29"]) {
      expect(listSeriesVerdict(bad, "crypto", Date.parse("2026-03-04T12:00:00.000Z")).verdict).toBe("unknown");
    }
    // A real leap day still reads.
    expect(listSeriesVerdict("2028-02-29", "crypto", Date.parse("2028-03-01T12:00:00.000Z")).verdict).toBe("current");
  });
});
