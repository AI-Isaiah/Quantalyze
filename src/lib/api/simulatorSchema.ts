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
// PR-3+4 H-1143 (audit-2026-05-07): both fields are FK targets that must be
// UUIDs in the producing tables. Pre-fix `.min(1)` permitted any non-empty
// string ("-", "undefined", crafted SQL fragments). Parameterized queries
// make injection inert, but a non-UUID id silently misses on the FK and
// returns a generic insufficient_data shape rather than surfacing the
// bad-input failure as 422 at the boundary.
export const SimulatorRequestSchema = z.object({
  portfolio_id: z.string().uuid(),
  candidate_strategy_id: z.string().uuid(),
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

// PR-3+4 H-1141 + H-RT-03 (audit-2026-05-07 + red-team 2026-05-28):
// pre-fix `z.string()` accepted any string (`""`, `"NaN"`,
// `"2026-13-99"`); downstream parseISO returned NaN and the chart
// dropped or rendered the bad point off-screen. `z.number()` permitted
// Infinity/NaN, which survived to Number.isFinite guards added in
// EquityChart.tsx — those guards are warm-up fallbacks, not boundary
// rejection. The shape regex alone admits `2026-13-99` which Date.UTC
// silently rolls to April; the `.refine` adds a calendar-validity gate
// so a malformed wire-shape never reaches the binary-search invariant
// in EquityChart.tsx's handleMove (which assumes monotonic epochs).
const EquityCurvePointSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO YYYY-MM-DD required")
    .refine(
      (s) => {
        const [y, m, d] = s.split("-").map(Number);
        if (m < 1 || m > 12 || d < 1 || d > 31) return false;
        // Round-trip via UTC Date: a rolled-over date (2026-02-30 →
        // 2026-03-02) produces mismatched components, so reject.
        const dt = new Date(Date.UTC(y, m - 1, d));
        return (
          dt.getUTCFullYear() === y &&
          dt.getUTCMonth() === m - 1 &&
          dt.getUTCDate() === d
        );
      },
      { message: "calendar-invalid ISO date" },
    ),
  value: z.number().finite(),
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
  // PR-3+4 C-RT-01 (red-team 2026-05-28): Python emits this on every
  // branch (`simulator_scoring.py:188` ok, `:145` insufficient_data,
  // `:_empty_result` non-ok). Pre-fix the field was undeclared; the
  // ok branch's `.strict()` would have 500'd every prod simulator call
  // — none of the 5 specialist agents caught this because the test
  // fixture was hand-built from the schema, never round-tripped from
  // real Python. Declaring it preserves fail-loud strict-mode.
  current_metrics_reliable: z.boolean(),
  current: SimulatorMetricsSchema,
} as const;

// NEW-C11-05: tighten the ok-branch to reject degenerate results that slip
// through if producer drift allows status="ok" with overlap_days=0 or all-null
// metrics. overlap_days < 30 on an ok row is incoherent (insufficient_data
// should have fired). At least one proposed metric must be non-null — an ok
// result with all nulls would render ±0 chips as a confident projection.
//
// PR-3+4 H-1142 / S-PR34-01 (audit-2026-05-07): `.strict()` on the ok
// branch only. See the non-ok scope note below for the asymmetric
// rationale (Python `_empty_result` emits the full ok shape on every
// non-ok status, so non-ok stays `.passthrough()` for wire-compatibility).
const SimulatorOkBranch = z
  .object({
    status: z.literal("ok"),
    ...SimulatorCommonShape,
    proposed: SimulatorMetricsSchema,
    deltas: SimulatorDeltasSchema,
    equity_curve_current: z.array(EquityCurvePointSchema),
    equity_curve_proposed: z.array(EquityCurvePointSchema),
  })
  .strict()
  .refine((d) => d.overlap_days >= 30, {
    message: "ok status requires overlap_days >= 30 (insufficient_data should have fired)",
    path: ["overlap_days"],
  })
  .refine(
    (d) =>
      d.proposed.sharpe !== null ||
      d.proposed.max_drawdown !== null ||
      d.proposed.avg_correlation !== null ||
      d.proposed.concentration !== null,
    {
      message: "ok status requires at least one non-null proposed metric",
      path: ["proposed"],
    },
  );

// PR-3+4 H-1142 scope note: the non-ok branches stay `.passthrough()`
// because the Python service (`_empty_result` in
// analytics-service/services/simulator_scoring.py) emits the FULL ok
// shape — proposed/deltas/equity_curve_current/equity_curve_proposed,
// all null-or-empty — on every non-ok branch for wire-shape uniformity.
// Tightening these branches would 5xx every non-ok response in prod.
// The discriminated-union ALREADY routes non-ok rows to a code path that
// reads none of those fields — the strict() guard is high-value on the
// `ok` branch where producer drift could ship a renamed metric to the
// browser as a silent unknown.
const SimulatorInsufficientDataBranch = z
  .object({
    status: z.literal("insufficient_data"),
    ...SimulatorCommonShape,
  })
  .passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: Python _empty_result emits the full ok shape on every non-ok branch; the discriminated union reads none of these fields and tightening would 5xx every non-ok response

const SimulatorAlreadyInPortfolioBranch = z
  .object({
    status: z.literal("already_in_portfolio"),
    ...SimulatorCommonShape,
  })
  .passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: Python _empty_result emits the full ok shape on every non-ok branch; the discriminated union reads none of these fields and tightening would 5xx every non-ok response

const SimulatorEmptyPortfolioBranch = z
  .object({
    status: z.literal("empty_portfolio"),
    ...SimulatorCommonShape,
  })
  .passthrough(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: Python _empty_result emits the full ok shape on every non-ok branch; the discriminated union reads none of these fields and tightening would 5xx every non-ok response

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

/**
 * NEW-C11-06: Single source of truth for delta field units.
 *
 * Without this map the unit decision ("ratio" vs "percent") lives in two
 * independent tables: deltaChips() in PortfolioImpactPanel.tsx and
 * buildDeltaAnnouncement(). If the producer changes dd_delta to emit
 * already-in-percent (×100), only the chip table or the announcement gets
 * updated — the other silently drifts. Co-locating with the schema means
 * both consumers import the same map, so a drift is a compile-time gap.
 *
 * "ratio"   → render as-is (e.g. +0.150 for Sharpe)
 * "percent" → field is a fraction; multiply ×100 when displaying (e.g. dd_delta)
 */
export const DELTA_UNITS: Record<
  keyof z.infer<typeof SimulatorDeltasSchema>,
  "ratio" | "percent"
> = {
  sharpe_delta: "ratio",
  dd_delta: "percent",
  corr_delta: "ratio",
  concentration_delta: "ratio",
};
