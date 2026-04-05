import { describe, it, expect } from "vitest";
import { formatPercent, formatNumber, formatCurrency, metricColor, cn } from "./utils";

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
