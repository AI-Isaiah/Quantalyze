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
 * isn't enumerated here, so restoring the type can't silently drop a read.
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
          .loose()
          .nullable()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

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
      .loose()
      .nullable()
      .optional(),
    compositeReturns: z.array(dailyPointSchema).optional(),
  })
  .loose();

export type RiskWidgetData = z.infer<typeof riskWidgetDataSchema>;

/** Re-export for inner widgets that annotate their composite series. */
export type { DailyPoint };
