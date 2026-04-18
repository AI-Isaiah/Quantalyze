import { describe, it, expect } from "vitest";
import { deriveOutcomeLabel } from "./bridge-outcome-label";

// Fixed clock override — all 15 cases use today: "2026-04-17" for determinism.
const TODAY = "2026-04-17";

// Helper: offset today by N days (positive = past, negative = future)
function daysAgo(n: number): string {
  const d = new Date("2026-04-17T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("deriveOutcomeLabel", () => {
  it("case 1 — day 0 Pending: allocated_at=today, no delta data", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: TODAY,
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: TODAY,
      today: TODAY,
    });
    expect(result).toEqual({ label: "Pending", value: "Pending", tone: "neutral" });
  });

  it("case 2 — Estimated day 1: +2.1% (1d)", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(1),
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: 210,
      estimated_days: 1,
      needs_recompute: false,
      created_at: daysAgo(1),
      today: TODAY,
    });
    expect(result).toEqual({ label: "Estimated", value: "Estimated: +2.1% (1d)", tone: "neutral" });
  });

  it("case 3 — Estimated day 3: +2.1% (3d) — D-12 canonical", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(3),
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: 210,
      estimated_days: 3,
      needs_recompute: false,
      created_at: daysAgo(3),
      today: TODAY,
    });
    expect(result).toEqual({ label: "Estimated", value: "Estimated: +2.1% (3d)", tone: "neutral" });
  });

  it("case 4 — Estimated day 7: negative estimate stays neutral", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(7),
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: -50,
      estimated_days: 7,
      needs_recompute: false,
      created_at: daysAgo(7),
      today: TODAY,
    });
    expect(result).toEqual({ label: "Estimated", value: "Estimated: -0.5% (7d)", tone: "neutral" });
  });

  it("case 5 — Estimated boundary day 29: +1.8% (29d) stays Estimated", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(29),
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: 175,
      estimated_days: 29,
      needs_recompute: false,
      created_at: daysAgo(29),
      today: TODAY,
    });
    expect(result).toEqual({ label: "Estimated", value: "Estimated: +1.8% (29d)", tone: "neutral" });
  });

  it("case 6 — 30-day: +4.3% — D-12 canonical realized (day 30 crosses)", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(30),
      delta_30d: 0.043,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: 430,
      estimated_days: 30,
      needs_recompute: false,
      created_at: daysAgo(30),
      today: TODAY,
    });
    expect(result).toEqual({ label: "30-day", value: "30-day: +4.3%", tone: "positive" });
  });

  it("case 7 — 30-day: day 89 with only 30d delta available", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(89),
      delta_30d: 0.043,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: daysAgo(89),
      today: TODAY,
    });
    expect(result).toEqual({ label: "30-day", value: "30-day: +4.3%", tone: "positive" });
  });

  it("case 8 — 90-day: +8.1%", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(90),
      delta_30d: 0.043,
      delta_90d: 0.081,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: daysAgo(90),
      today: TODAY,
    });
    expect(result).toEqual({ label: "90-day", value: "90-day: +8.1%", tone: "positive" });
  });

  it("case 9 — 90-day: day 179 shows 90-day (180d not yet reached)", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(179),
      delta_30d: 0.043,
      delta_90d: 0.081,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: daysAgo(179),
      today: TODAY,
    });
    expect(result).toEqual({ label: "90-day", value: "90-day: +8.1%", tone: "positive" });
  });

  it("case 10 — 180-day: -2.3% — D-12 realized negative", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(180),
      delta_30d: 0.043,
      delta_90d: 0.081,
      delta_180d: -0.023,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: daysAgo(180),
      today: TODAY,
    });
    expect(result).toEqual({ label: "180-day", value: "180-day: -2.3%", tone: "negative" });
  });

  it("case 11 — cron-failed: day 30+ with null delta stays Pending (D-14)", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(30),
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: true,
      created_at: daysAgo(30),
      today: TODAY,
    });
    expect(result).toEqual({ label: "Pending", value: "Pending", tone: "neutral" });
  });

  it("case 12 — day 5 with no estimate computed yet → Pending", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(5),
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: daysAgo(5),
      today: TODAY,
    });
    expect(result).toEqual({ label: "Pending", value: "Pending", tone: "neutral" });
  });

  it("case 13 — 30-day exact zero: +0.0% tone=neutral (D-13)", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(45),
      delta_30d: 0,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: daysAgo(45),
      today: TODAY,
    });
    expect(result).toEqual({ label: "30-day", value: "30-day: +0.0%", tone: "neutral" });
  });

  it("case 14 — 180-day double-digit negative: -15.0%", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(200),
      delta_30d: null,
      delta_90d: null,
      delta_180d: -0.15,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: daysAgo(200),
      today: TODAY,
    });
    expect(result).toEqual({ label: "180-day", value: "180-day: -15.0%", tone: "negative" });
  });

  it("case 15 — future allocated_at → Pending (daysSinceAllocated clamped to 0)", () => {
    const result = deriveOutcomeLabel({
      kind: "allocated",
      allocated_at: daysAgo(-1), // tomorrow
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: false,
      created_at: TODAY,
      today: TODAY,
    });
    expect(result).toEqual({ label: "Pending", value: "Pending", tone: "neutral" });
  });
});
