/**
 * Zod contract for POST /api/simulator.
 *
 * The Next.js route proxies Python `/api/simulator` and parses the response
 * through `SimulatorResponseSchema` — parse failures throw so shape drift
 * surfaces loudly. See `SimulatorDeltas` in ../types.ts for the sign convention.
 *
 * audit-2026-05-07 H-1120 / H-1121 / M-0911 / M-0912: this schema is now the
 * single source of truth for the simulator response. `types.ts` re-exports
 * `SimulatorCandidate = z.infer<typeof SimulatorResponseSchema>` so the
 * hand-written interface no longer drifts out of lock-step. The response is
 * a discriminated union on `status` so `equity_curve_*` and `proposed`/`deltas`
 * are TYPED ONLY on the `ok` branch — illegal states (proposed metrics on an
 * `already_in_portfolio` row) cease to be representable.
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

// NEW-C11-01: deltas are nullable — a null means the operand metric was not
// computable (e.g. flat-returns → Sharpe=None upstream). Nullable deltas
// render as a distinct "— / not computable" state in the UI rather than a
// confident "unchanged" neutral chip (±0.000), which was indistinguishable
// from a real zero-impact result and could mislead allocation decisions.
export const SimulatorDeltasSchema = z.object({
  sharpe_delta: z.number().nullable(),
  dd_delta: z.number().nullable(),
  corr_delta: z.number().nullable(),
  concentration_delta: z.number().nullable(),
});

const EquityCurvePointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

// audit-2026-05-07 M-0912: partial_history is derivable from
// overlap_days < PARTIAL_HISTORY_THRESHOLD (126 trading days, mirrors
// `simulator_scoring.py:438`). Keep both fields for wire compatibility
// AND refine to refuse contradictory rows (e.g. partial_history=false
// with overlap_days=5).
export const PARTIAL_HISTORY_THRESHOLD = 126;

const SimulatorCommonShape = {
  candidate_id: z.string(),
  candidate_name: z.string(),
  portfolio_id: z.string(),
  overlap_days: z.number().int().nonnegative(),
  partial_history: z.boolean(),
  current: SimulatorMetricsSchema,
} as const;

const SimulatorOkBranch = z
  .object({
    status: z.literal("ok"),
    ...SimulatorCommonShape,
    proposed: SimulatorMetricsSchema,
    deltas: SimulatorDeltasSchema,
    equity_curve_current: z.array(EquityCurvePointSchema),
    equity_curve_proposed: z.array(EquityCurvePointSchema),
  })
  .passthrough();

const SimulatorInsufficientDataBranch = z
  .object({
    status: z.literal("insufficient_data"),
    ...SimulatorCommonShape,
  })
  .passthrough();

const SimulatorAlreadyInPortfolioBranch = z
  .object({
    status: z.literal("already_in_portfolio"),
    ...SimulatorCommonShape,
  })
  .passthrough();

const SimulatorEmptyPortfolioBranch = z
  .object({
    status: z.literal("empty_portfolio"),
    ...SimulatorCommonShape,
  })
  .passthrough();

export const SimulatorResponseSchema = z
  .discriminatedUnion("status", [
    SimulatorOkBranch,
    SimulatorInsufficientDataBranch,
    SimulatorAlreadyInPortfolioBranch,
    SimulatorEmptyPortfolioBranch,
  ])
  .refine(
    (d) => d.partial_history === (d.overlap_days < PARTIAL_HISTORY_THRESHOLD),
    {
      message:
        "partial_history inconsistent with overlap_days (must equal overlap_days < PARTIAL_HISTORY_THRESHOLD)",
    },
  );

export type SimulatorResponse = z.infer<typeof SimulatorResponseSchema>;

/** The `status === "ok"` branch — the only shape where rich result
 *  fields (deltas, proposed metrics, equity curves) are guaranteed
 *  present. Narrow via `if (response.status === "ok")` before passing
 *  to components that read those fields. */
export type SimulatorResponseOk = Extract<SimulatorResponse, { status: "ok" }>;
