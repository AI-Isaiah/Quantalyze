/**
 * F4b — Strategy-row adapter for the Holdings tab.
 *
 * The Holdings tab renders ONE ROW PER ONBOARDED STRATEGY (the allocator's
 * `portfolio_strategies`), not per raw exchange position. This adapter maps
 * `MyAllocationDashboardPayload.strategies[]` directly into the designer row
 * shape — there is no holding→strategy join to invent (every input element is
 * already a portfolio strategy).
 *
 * Discipline (mirrors `holdings-adapter.ts`):
 *   - pure: zero I/O, zero DOM access
 *   - `now` is an injectable input for deterministic age math in tests
 *   - disclosure-tier redaction is preserved: the strategy name routes through
 *     `displayStrategyName` (alias wins, then codename, then a synthetic id),
 *     and `manager` consumes the already-server-redacted `organization_name`
 *     (null on non-institutional rows) with a codename fallback.
 */

import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { DisclosureTier } from "@/lib/types";
import { displayStrategyName } from "@/lib/strategy-display";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";

export interface StrategyRow {
  /** Stable React key — `portfolio_strategies.strategy_id`. */
  id: string;
  /** Display name: alias wins, else tier-aware `displayStrategyName`. */
  strategy: string;
  /**
   * Managing org/team. `organization_name` is already server-redacted (null
   * on non-institutional rows); fall through to `codename` (the safe
   * pseudonym), then null. Never leaks manager identity on exploratory tiers.
   */
  manager: string | null;
  /** Portfolio weight as a fraction (current_weight), or null. */
  weight: number | null;
  /** Allocated amount in USD (allocated_amount), or null. */
  allocation: number | null;
  /** Month-to-date return derived from daily_returns. Null when no data. */
  mtd: number | null;
  sharpe: number | null;
  maxDd: number | null;
  /** Whole days since `added_at`. Clamped to >= 0 (defensive vs clock skew). */
  age: number;
}

export interface StrategyRowAdapterInputs {
  strategies: MyAllocationDashboardPayload["strategies"];
  /** Injectable "now" for deterministic age math. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Month-to-date return from the strategy's `daily_returns` series.
 *
 * Mirrors the Python `compute_period_returns` MTD contract
 * (`analytics-service/services/portfolio_metrics.py`): anchor on the LAST
 * OBSERVED date in the series (not the wall clock), take the first calendar
 * day of that date's month, and compound every daily return on or after it:
 * `(1 + r1)·(1 + r2)·… − 1`. `normalizeDailyReturns` handles the nested
 * year-keyed JSONB shape and returns a date-ascending `{date, value}[]`.
 */
function computeMtd(rawDailyReturns: unknown): number | null {
  const points = normalizeDailyReturns(rawDailyReturns);
  if (points.length === 0) return null;
  const lastDate = points[points.length - 1].date; // "YYYY-MM-DD", sorted asc
  const monthStart = `${lastDate.slice(0, 7)}-01`; // first day of last month
  const slice = points.filter((p) => p.date >= monthStart);
  if (slice.length === 0) return null;
  let compound = 1;
  for (const p of slice) {
    if (Number.isFinite(p.value)) compound *= 1 + p.value;
  }
  const mtd = compound - 1;
  return Number.isFinite(mtd) ? mtd : null;
}

export function toStrategyRows(inputs: StrategyRowAdapterInputs): StrategyRow[] {
  const nowMs = (inputs.now ?? new Date()).getTime();

  return inputs.strategies.map((ps): StrategyRow => {
    const s = ps.strategy;

    const strategy =
      ps.alias?.trim() ||
      displayStrategyName({
        id: s.id,
        name: s.name,
        codename: s.codename ?? null,
        disclosure_tier: (s.disclosure_tier ?? null) as DisclosureTier | null,
      });

    // organization_name is already null for non-institutional rows
    // (server-side redaction); codename is the safe public pseudonym.
    const manager = s.organization_name ?? s.codename ?? null;

    const ageMs = nowMs - new Date(ps.added_at).getTime();
    const age = ageMs >= 0 ? Math.floor(ageMs / 86_400_000) : 0;

    return {
      id: ps.strategy_id,
      strategy,
      manager,
      weight: ps.current_weight,
      allocation: ps.allocated_amount,
      mtd: computeMtd(s.strategy_analytics?.daily_returns),
      sharpe: s.strategy_analytics?.sharpe ?? null,
      maxDd: s.strategy_analytics?.max_drawdown ?? null,
      age,
    };
  });
}
