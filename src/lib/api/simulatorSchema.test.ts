import { describe, expect, it } from "vitest";
import {
  SimulatorRequestSchema,
  SimulatorResponseSchema,
} from "./simulatorSchema";

describe("SimulatorRequestSchema", () => {
  it("accepts a valid request", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: "p1",
      candidate_strategy_id: "c1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty strings", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: "",
      candidate_strategy_id: "c1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = SimulatorRequestSchema.safeParse({
      portfolio_id: "p1",
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

  it("allows additional unknown fields (passthrough)", () => {
    const result = SimulatorResponseSchema.safeParse({
      ...validResponse,
      future_field: "ignored",
    });
    expect(result.success).toBe(true);
  });
});
