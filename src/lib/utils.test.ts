import { describe, it, expect } from "vitest";
import {
  formatPercent,
  formatNumber,
  formatCurrency,
  metricColor,
  cn,
  formatRelativeTime,
  formatAbsoluteDate,
  isUuid,
  minuteBucket,
  UUID_RE,
} from "./utils";

describe("formatPercent", () => {
  it("formats positive percentages", () => {
    expect(formatPercent(0.1523)).toBe("+15.23%");
  });
  it("formats negative percentages", () => {
    expect(formatPercent(-0.0342)).toBe("-3.42%");
  });
  it("returns dash for null", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatNumber", () => {
  it("formats with 2 decimals by default", () => {
    expect(formatNumber(1.5)).toBe("1.50");
  });
  it("formats large numbers with commas", () => {
    expect(formatNumber(12345.67)).toBe("12,345.67");
  });
  it("returns dash for null", () => {
    expect(formatNumber(null)).toBe("—");
  });
});

describe("formatCurrency", () => {
  it("formats millions", () => {
    expect(formatCurrency(5500000)).toBe("$5.5M");
  });
  it("formats thousands", () => {
    expect(formatCurrency(250000)).toBe("$250K");
  });
  it("returns dash for null", () => {
    expect(formatCurrency(null)).toBe("—");
  });
});

describe("metricColor", () => {
  it("returns positive class for positive values", () => {
    expect(metricColor(0.5)).toBe("text-positive");
  });
  it("returns negative class for negative values", () => {
    expect(metricColor(-0.1)).toBe("text-negative");
  });
  it("returns muted class for null", () => {
    expect(metricColor(null)).toBe("text-text-muted");
  });
});

describe("cn", () => {
  it("joins class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });
  it("filters falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("isUuid / UUID_RE", () => {
  it("accepts canonical UUID v4", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });
  it("accepts uppercase hex", () => {
    expect(isUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });
  it("rejects strings missing hyphens", () => {
    expect(isUuid("123e4567e89b12d3a456426614174000")).toBe(false);
  });
  it("rejects non-hex characters", () => {
    expect(isUuid("zzze4567-e89b-12d3-a456-426614174000")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid({})).toBe(false);
  });
  it("UUID_RE is the same regex as isUuid uses", () => {
    expect(UUID_RE.test("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });
});

describe("formatAbsoluteDate", () => {
  it("returns a stable en-US short form in UTC", () => {
    // UTC slice so SSR/CSR hydration produces identical output.
    expect(formatAbsoluteDate("2026-04-11T08:30:00Z")).toBe("Apr 11");
  });
  it("handles year boundary correctly", () => {
    expect(formatAbsoluteDate("2026-01-01T00:00:00Z")).toBe("Jan 1");
  });
});

describe("formatRelativeTime", () => {
  const NOW = new Date("2026-04-11T12:00:00Z").getTime();

  it("returns 'just now' when under 30 seconds", () => {
    const iso = new Date(NOW - 20_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe("just now");
  });
  it("rounds to 1m at the 30s boundary", () => {
    const iso = new Date(NOW - 30_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe("1m ago");
  });
  it("returns minutes in the 1-59 range", () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe("5m ago");
  });
  it("returns hours once the gap crosses 60 minutes", () => {
    const iso = new Date(NOW - 3 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe("3h ago");
  });
  it("returns days once the gap crosses 24 hours", () => {
    const iso = new Date(NOW - 4 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe("4d ago");
  });
  it("falls back to absolute date past 30 days", () => {
    const iso = new Date(NOW - 45 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, NOW)).toBe(formatAbsoluteDate(iso));
  });
});

describe("minuteBucket", () => {
  it("is stable within the same minute", () => {
    const base = new Date("2026-04-11T12:00:00Z").getTime();
    expect(minuteBucket(base)).toBe(minuteBucket(base + 30_000));
  });
  it("changes when the minute rolls over", () => {
    const base = new Date("2026-04-11T12:00:00Z").getTime();
    expect(minuteBucket(base)).not.toBe(minuteBucket(base + 60_001));
  });
});
