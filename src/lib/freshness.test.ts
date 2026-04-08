import { describe, it, expect } from "vitest";
import {
  computeFreshness,
  freshnessLabel,
  freshnessTooltip,
  FRESHNESS_COLORS,
  FRESH_HOURS,
  WARM_HOURS,
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
