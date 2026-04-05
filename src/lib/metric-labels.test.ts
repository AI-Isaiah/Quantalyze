import { describe, it, expect } from "vitest";
import { getMetricLabel } from "./metric-labels";

describe("getMetricLabel", () => {
  it("returns null for unknown metrics", () => {
    expect(getMetricLabel("unknown_metric", 1.5)).toBeNull();
  });

  it("returns null for null values", () => {
    expect(getMetricLabel("sharpe", null)).toBeNull();
  });

  it("returns null for undefined values", () => {
    expect(getMetricLabel("sharpe", undefined)).toBeNull();
  });

  describe("sharpe thresholds", () => {
    it("negative sharpe = Poor", () => {
      const r = getMetricLabel("sharpe", -0.5);
      expect(r?.label).toBe("Poor");
      expect(r?.color).toBe("negative");
    });

    it("sharpe 0.5 = Below avg", () => {
      const r = getMetricLabel("sharpe", 0.5);
      expect(r?.label).toBe("Below avg");
    });

    it("sharpe 1.2 = Good", () => {
      const r = getMetricLabel("sharpe", 1.2);
      expect(r?.label).toBe("Good");
    });

    it("sharpe 2.0 = Excellent", () => {
      const r = getMetricLabel("sharpe", 2.0);
      expect(r?.label).toBe("Excellent");
      expect(r?.color).toBe("positive");
    });

    it("sharpe 3.5 = Outstanding", () => {
      const r = getMetricLabel("sharpe", 3.5);
      expect(r?.label).toBe("Outstanding");
    });
  });

  describe("max_drawdown thresholds", () => {
    it("severe drawdown", () => {
      const r = getMetricLabel("max_drawdown", -0.6);
      expect(r?.label).toBe("Severe");
    });

    it("moderate drawdown", () => {
      const r = getMetricLabel("max_drawdown", -0.2);
      expect(r?.label).toBe("Moderate");
    });

    it("low drawdown", () => {
      const r = getMetricLabel("max_drawdown", -0.05);
      expect(r?.label).toBe("Low");
      expect(r?.color).toBe("positive");
    });
  });

  describe("cagr thresholds", () => {
    it("negative cagr", () => {
      expect(getMetricLabel("cagr", -0.1)?.label).toBe("Negative");
    });

    it("strong cagr", () => {
      expect(getMetricLabel("cagr", 0.5)?.label).toBe("Strong");
    });
  });

  describe("boundary values", () => {
    it("sharpe exactly 0 = Below avg (not Poor)", () => {
      expect(getMetricLabel("sharpe", 0)?.label).toBe("Below avg");
    });

    it("sharpe exactly 1.5 = Excellent (not Good)", () => {
      expect(getMetricLabel("sharpe", 1.5)?.label).toBe("Excellent");
    });
  });
});
