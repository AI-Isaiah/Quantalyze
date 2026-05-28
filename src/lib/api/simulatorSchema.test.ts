import { describe, expect, it } from "vitest";
import {
  DELTA_UNITS,
  SimulatorRequestSchema,
  SimulatorResponseSchema,
} from "./simulatorSchema";

// PR-3+4 H-1143 (audit-2026-05-07): SimulatorRequestSchema tightened from
// `z.string().min(1)` to `z.string().uuid()` on both FK fields. Tests pin
// the new contract: valid UUIDs accepted, non-UUID strings (including the
// legacy `"p1"` / `"c1"` shorthand and crafted attacker payloads) rejected
// at 422 before the route forwards to Python.
const VALID_PORTFOLIO_UUID = "11111111-1111-4111-8111-111111111111";
const VALID_CANDIDATE_UUID = "22222222-2222-4222-8222-222222222222";

describe("SimulatorRequestSchema", () => {
  it("accepts a valid UUID-shaped request", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: VALID_PORTFOLIO_UUID,
      candidate_strategy_id: VALID_CANDIDATE_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("H-1143: rejects non-UUID portfolio_id", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: "p1",
      candidate_strategy_id: VALID_CANDIDATE_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("H-1143: rejects non-UUID candidate_strategy_id (crafted attacker payload)", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: VALID_PORTFOLIO_UUID,
      candidate_strategy_id: "' OR 1=1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty strings", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: "",
      candidate_strategy_id: VALID_CANDIDATE_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: VALID_PORTFOLIO_UUID,
    });
    expect(result.success).toBe(false);
  });
});

describe("SimulatorResponseSchema", () => {
  const validResponse = {
    candidate_id: "c1",
    candidate_name: "High Sharpe Strategy",
    portfolio_id: "p1",
    status: "ok",
    overlap_days: 180,
    partial_history: false,
    current_metrics_reliable: true,
    deltas: {
      sharpe_delta: 0.15,
      dd_delta: 0.02,
      corr_delta: 0.03,
      concentration_delta: 0.05,
    },
    current: {
      sharpe: 1.2,
      max_drawdown: -0.18,
      avg_correlation: 0.45,
      concentration: 0.5,
    },
    proposed: {
      sharpe: 1.35,
      max_drawdown: -0.16,
      avg_correlation: 0.42,
      concentration: 0.45,
    },
    equity_curve_current: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.005 },
    ],
    equity_curve_proposed: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.008 },
    ],
  };

  it("parses a well-formed success response", () => {
    const result = SimulatorResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it("rejects invalid status enum", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      status: "unknown_status",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null metrics in current/proposed (insufficient_data path)", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      status: "insufficient_data",
      proposed: {
        sharpe: null,
        max_drawdown: null,
        avg_correlation: null,
        concentration: null,
      },
      equity_curve_proposed: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-numeric delta values", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      deltas: {
        sharpe_delta: "0.15",
        dd_delta: 0.02,
        corr_delta: 0.03,
        concentration_delta: 0.05,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative overlap_days", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      overlap_days: -1,
    });
    expect(result.success).toBe(false);
  });

  // PR-3+4 H-1142 (audit-2026-05-07): the `ok` branch is now `.strict()`.
  // Producer drift (renamed metric, debug field, accidental PII leak from
  // Python) fails parse at the boundary instead of riding through to the
  // browser as a silent unknown. Pre-fix `.passthrough()` ate everything.
  it("H-1142: rejects unknown fields on the ok branch (strict)", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      future_field: "ignored",
    });
    expect(result.success).toBe(false);
  });

  // Non-ok branches stay `.passthrough()` because Python's _empty_result
  // (analytics-service/services/simulator_scoring.py) emits the full ok
  // shape — proposed/deltas/equity_curve_* — with nulls on every non-ok
  // status for wire-shape uniformity. The discriminated union routes
  // non-ok rows away from the consumers that read those fields.
  it("H-1142: passthrough still active on non-ok branches", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      status: "insufficient_data",
      overlap_days: 10,
      partial_history: true,
      future_field: "ignored",
    });
    expect(result.success).toBe(true);
  });

  // audit-2026-05-07 M-0912: partial_history must equal overlap_days < 126.
  it("rejects partial_history=false when overlap_days < threshold", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      overlap_days: 50,
      partial_history: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects partial_history=true when overlap_days >= threshold", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      overlap_days: 200,
      partial_history: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts partial_history=true with overlap_days < threshold", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      overlap_days: 50,
      partial_history: true,
    });
    expect(result.success).toBe(true);
  });

  // PR-3+4 NEW-C11-05 regression coverage (audit-2026-05-07): the two
  // ok-branch refines previously had zero tests. A producer-side
  // regression that ships `status: "ok"` with overlap_days < 30 or all
  // proposed metrics null would silently parse and the UI would render
  // ±0 chips as a confident projection.
  it("NEW-C11-05: rejects ok status with overlap_days < 30 (insufficient_data should have fired)", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      overlap_days: 29,
      partial_history: true,
    });
    expect(result.success).toBe(false);
  });

  it("NEW-C11-05: rejects ok status with all-null proposed metrics", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      proposed: {
        sharpe: null,
        max_drawdown: null,
        avg_correlation: null,
        concentration: null,
      },
    });
    expect(result.success).toBe(false);
  });

  it("NEW-C11-05: accepts ok status with one non-null proposed metric (boundary)", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      proposed: {
        sharpe: 1.2,
        max_drawdown: null,
        avg_correlation: null,
        concentration: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("H-1141: rejects equity_curve point with non-ISO date", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      equity_curve_current: [{ date: "not-a-date", value: 1.0 }],
    });
    expect(result.success).toBe(false);
  });

  // PR-3+4 H-RT-03 (red-team 2026-05-28): the shape regex alone
  // accepted `2026-13-99` because Date.UTC rolls invalid components
  // forward. The refine catches calendar-invalid inputs so the
  // EquityChart binary-search monotonicity invariant cannot be broken
  // by a poisoned wire shape.
  it("H-RT-03: rejects calendar-invalid ISO date (month=13)", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      equity_curve_current: [{ date: "2026-13-01", value: 1.0 }],
    });
    expect(result.success).toBe(false);
  });

  it("H-RT-03: rejects calendar-invalid ISO date (day=31 in Feb)", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      equity_curve_current: [{ date: "2026-02-31", value: 1.0 }],
    });
    expect(result.success).toBe(false);
  });

  it("H-1141: rejects equity_curve point with NaN value", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      equity_curve_current: [{ date: "2025-01-01", value: Number.NaN }],
    });
    expect(result.success).toBe(false);
  });

  // audit-2026-05-07 H-1120: discriminated union — proposed/deltas/curves
  // are NOT required on non-ok status.
  it("accepts insufficient_data without proposed/deltas/curves", () => {
    const result = SimulatorResponseSchema.safeParse({
      candidate_id: "c1",
      candidate_name: "Strategy",
      portfolio_id: "p1",
      status: "insufficient_data",
      overlap_days: 5,
      partial_history: true,
      current_metrics_reliable: false,
      current: {
        sharpe: null,
        max_drawdown: null,
        avg_correlation: null,
        concentration: null,
      },
    });
    expect(result.success).toBe(true);
  });
});

// PR-3+4 NEW-C11-06 regression coverage (audit-2026-05-07): the
// DELTA_UNITS map is the single source of truth for delta-field unit
// rendering. A producer change to dd_delta units (e.g. switching to
// already-in-percent) MUST update this map so the chip table and the
// announcement table stay in lockstep — without this pin, either
// table can drift silently.
describe("DELTA_UNITS contract", () => {
  it("pins the units map shape", () => {
    expect(DELTA_UNITS).toEqual({
      sharpe_delta: "ratio",
      dd_delta: "percent",
      corr_delta: "ratio",
      concentration_delta: "ratio",
    });
  });
});
