import { z } from "zod";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

/**
 * B21 widget data contracts.
 *
 * Each schema is BOTH the runtime validator (consumed by `withWidgetBoundary`)
 * AND the inner component's `data` type (`z.infer`), so a widget declares the
 * shape it reads exactly once — replacing the old `WidgetProps.data: any` +
 * `props as any` cast at the tab panel.
 *
 * Leaf fields that every consumer already pipes through a normalizer
 * (`daily_returns` → `normalizeDailyReturns`; `correlation_matrix` → a guarded
 * shape check) are typed `unknown` ON PURPOSE: those normalizers/guards ARE the
 * trust boundary for the field, and `unknown` forces callers through them
 * rather than touching raw shapes. The schema's job is the surrounding
 * STRUCTURE — that `strategies` is an array and the label/weight fields are the
 * types the widgets render — so the `.map` / `for…of` / `nameMap[id]` paths are
 * safe without `any`.
 *
 * `.loose()` (zod v4 passthrough) keeps any payload field a widget reads that
 * isn't enumerated here, so restoring the type can't silently drop a read. Each
 * `.loose()` carries a B9 sanctioned-exception: these are read-only RENDER
 * contracts (the widget displays the payload, never writes it back), so keeping
 * unknown fields is safe forward-compat, not the NEW-C40-01 write-leak class.
 */

const dailyPointSchema = z.object({ date: z.string(), value: z.number() });

/**
 * The slice of a `MyAllocationDashboardPayload.strategies[number]` that the
 * risk / attribution / intelligence widgets read: weight (for the weighted
 * composite), the display-label candidates, and the `daily_returns` leaf they
 * feed to `normalizeDailyReturns`.
 */
const riskStrategyRowSchema = z
  .object({
    strategy_id: z.string().optional(),
    alias: z.string().nullable().optional(),
    current_weight: z.number().nullable().optional(),
    weight: z.number().optional(),
    // `strategy` is always present on a payload row (never null); `.optional()`
    // covers the theoretical absent case while matching the `StrategyInput`
    // contract of `buildCompositeReturns` (which has `strategy?:`, not nullable).
    strategy: z
      .object({
        id: z.string().optional(),
        name: z.string().nullable().optional(),
        codename: z.string().nullable().optional(),
        strategy_analytics: z
          .object({ daily_returns: z.unknown() })
          .loose() // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write
          .nullable()
          .optional(),
      })
      .loose() // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write
      .optional(),
  })
  .loose(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write

/**
 * Shared contract for the seven `{strategies, analytics?, compositeReturns?}`
 * widgets (TailRisk, VarExpectedShortfall, RiskDecomposition, CorrelationMatrix,
 * RegimeDetector, AlphaBetaDecomposition, DrawdownChart). `compositeReturns` is
 * an optional precomputed override (injected by tests; absent in prod, where
 * widgets fall back to `buildCompositeReturns(strategies)`).
 */
export const riskWidgetDataSchema = z
  .object({
    strategies: z.array(riskStrategyRowSchema),
    analytics: z
      .object({ correlation_matrix: z.unknown().optional() })
      .loose() // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write
      .nullable()
      .optional(),
    compositeReturns: z.array(dailyPointSchema).optional(),
  })
  .loose(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write

export type RiskWidgetData = z.infer<typeof riskWidgetDataSchema>;

/**
 * Overlay series the EquityChart widget renders (benchmark + comparison lines).
 * `points` feed the same `parseISO` / SVG-path math as `equityDailyPoints`, so
 * the element shape is pinned to `{date, value}` (not `unknown`).
 */
const overlaySeriesSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    color: z.string(),
    points: z.array(dailyPointSchema),
  })
  .loose(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write

/**
 * Contract for the direct-mount `EquityChartWidget` (factsheet Overview /
 * AllocationDashboardV2). The mount passes the WHOLE `MyAllocationDashboardPayload`,
 * so `.loose()` keeps the dozens of unread fields; the schema pins only the
 * leaves the widget reads and feeds to `parseISO` / `anchorFromFirstPositive` /
 * the SVG path builder.
 *
 * Unlike the risk widgets, these point arrays do NOT flow through a downstream
 * normalizer — `equityDailyPoints` goes straight into anchor/SVG math — so
 * `{date, value}` IS the correct trust boundary for the leaf (NOT `unknown`).
 * (Note: `z.number()` still accepts `NaN`; the `Number.isFinite` guards inside
 * the chart's `toPath` remain the defense against a NaN coordinate. The schema
 * guarantees STRUCTURE — arrays of the right element shape — not finiteness.)
 *
 * All fields optional: during first-connect the payload legitimately omits the
 * equity leaves (warm-up), which the boundary's `onInvalid: "empty"` renders as
 * "warming up" rather than an error.
 */
export const equityChartWidgetDataSchema = z
  .object({
    equityDailyPoints: z.array(dailyPointSchema).optional(),
    btcBenchmark: z.array(dailyPointSchema).nullable().optional(),
    equityOverlays: z.array(overlaySeriesSchema).nullable().optional(),
    allKeysStale: z.boolean().optional(),
    lastSyncAt: z.string().nullable().optional(),
  })
  .loose(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write

export type EquityChartWidgetData = z.infer<typeof equityChartWidgetDataSchema>;

/**
 * The `OutcomeRow` slice the OutcomesWidget reads. Every field is a trusted
 * scalar the widget does math/branching on directly (no normalizer-piped blob),
 * so each gets a real type rather than `unknown`. `.loose()` preserves the
 * extra `OutcomeRow` fields (`note`, `estimated_delta_bps`, …) the widget
 * passes through to `computeOutcomeKPIs` / `TimelineRow`.
 */
const outcomeRowSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["allocated", "rejected"]),
    percent_allocated: z.number().nullable(),
    allocated_at: z.string().nullable(),
    created_at: z.string(),
    delta_30d: z.number().nullable(),
    delta_90d: z.number().nullable(),
    delta_180d: z.number().nullable(),
    replacement_strategy: z
      .object({ id: z.string(), name: z.string() })
      .nullable(),
    match_decision: z
      .object({ original_strategy: z.object({ id: z.string(), name: z.string() }) })
      .nullable(),
  })
  .loose(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write

/**
 * Contract for the direct-mount `OutcomesWidget` (OutcomesTabPanel). The mount
 * passes the WHOLE payload; the widget reads only `outcomes` plus the `__error`
 * sentinel. `outcomes` is `.optional()` ON PURPOSE: `outcomes === undefined` is
 * the loading path (the widget renders its own `<LoadingState />`), so a
 * still-loading payload must PASS the schema and reach the widget — the
 * boundary's `onInvalid: "error"` then fires only on genuine drift (a non-array
 * `outcomes`, a row with a bad `kind`/`delta`), not during load. `__error` is
 * only truthiness-checked, so `unknown` is correct.
 */
export const outcomesWidgetDataSchema = z
  .object({
    outcomes: z.array(outcomeRowSchema).optional(),
    __error: z.unknown().optional(),
  })
  .loose(); // eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: read-only widget render contract (withWidgetBoundary display), never spread into a write

export type OutcomesWidgetData = z.infer<typeof outcomesWidgetDataSchema>;

/** Re-export for inner widgets that annotate their composite series. */
export type { DailyPoint };
