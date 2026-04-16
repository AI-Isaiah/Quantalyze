/**
 * Zod contract for the portfolio impact simulator (Sprint 6 Task 6.4).
 *
 * Validates the response shape returned by POST /api/simulator. The
 * Next.js route calls the Python `/api/simulator` endpoint and parses the
 * raw JSON through this schema before returning it to the client. Parse
 * failures throw (strict contract) so UI bugs from shape drift are loud
 * rather than silent.
 *
 * Deltas follow the "positive = improvement" sign convention — see
 * `analytics-service/services/simulator_scoring.py` for the canonical
 * definition.
 */

import { z } from "zod";

export const SimulatorStatusSchema = z.enum([
  "ok",
  "insufficient_data",
  "already_in_portfolio",
  "empty_portfolio",
]);

/** POST body contract for /api/simulator. */
export const SimulatorRequestSchema = z.object({
  portfolio_id: z.string().min(1),
  candidate_strategy_id: z.string().min(1),
});

export type SimulatorRequest = z.infer<typeof SimulatorRequestSchema>;

export const SimulatorMetricsSchema = z.object({
  sharpe: z.number().nullable(),
  max_drawdown: z.number().nullable(),
  avg_correlation: z.number().nullable(),
  concentration: z.number().nullable(),
});

export const SimulatorDeltasSchema = z.object({
  sharpe_delta: z.number(),
  dd_delta: z.number(),
  corr_delta: z.number(),
  concentration_delta: z.number(),
});

const EquityCurvePointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

export const SimulatorResponseSchema = z
  .object({
    candidate_id: z.string(),
    candidate_name: z.string(),
    portfolio_id: z.string(),
    status: SimulatorStatusSchema,
    overlap_days: z.number().int().nonnegative(),
    partial_history: z.boolean(),
    deltas: SimulatorDeltasSchema,
    current: SimulatorMetricsSchema,
    proposed: SimulatorMetricsSchema,
    equity_curve_current: z.array(EquityCurvePointSchema),
    equity_curve_proposed: z.array(EquityCurvePointSchema),
  })
  // Passthrough rather than strict so future-safe additions (e.g. a
  // confidence interval band on the proposed curve) don't break parsing.
  // Upgrade to .strict() once the contract is frozen.
  .passthrough();

export type SimulatorResponse = z.infer<typeof SimulatorResponseSchema>;
