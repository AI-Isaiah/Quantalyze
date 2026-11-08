import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { blendPeriodsPerYear } from "@/lib/closed-sets";
import { figureRecord, type FigureRecord } from "@/lib/figure-gate";
import {
  RECORD_SCALAR_ALIASES,
  recordFromScalars,
  type RecordScalarRow,
} from "@/lib/figure-record-scalars";
import type { PortfolioAnalytics } from "@/lib/types";

/**
 * Snapshot of an allocator's primary portfolio at intro-request time.
 *
 * Written into `contact_requests.portfolio_snapshot` so the manager receiving
 * the intro has a compact picture of the allocator's book: where they are
 * strong/weak, how concentrated they run, and how many alerts have fired in
 * the last week. Everything here is derived from user-owned rows (portfolios,
 * portfolio_strategies, portfolio_analytics, strategy_analytics, portfolio_alerts).
 *
 * The /api/intro route calls this with a 2s budget. If the compute does not
 * resolve in time, the route inserts snapshot_status='pending' and enqueues a
 * compute_intro_snapshot compute job to finish the computation asynchronously.
 */

/**
 * Phase 194.1 B12c (194 D-12 / D-15, 2026-11-08) - the record a frozen Sharpe was
 * computed on, frozen BESIDE it: `span_days` (covered days, D-20), the stored
 * `observations` count, and `crypto`; `unreadable` only when a date was present but not a
 * date. The admin intros page judges a Sharpe with `gateAnnualized` over this record.
 * Optional on purpose: a snapshot frozen before this phase has none, and a missing record
 * means "unknown, show the figure as stored", never a verdict. Python twin:
 * `figure_record_from_scalars` in analytics-service/services/metrics.py (one shared
 * fixture, `intro_snapshot_record_parity.json`, pins the pair).
 */
const SNAPSHOT_RECORD = z.object({
  span_days: z.number().nullable(),
  observations: z.number().nullable(),
  crypto: z.boolean(),
  unreadable: z.literal(true).optional(),
});

export type SnapshotRecord = z.infer<typeof SNAPSHOT_RECORD>;

/** The frozen (snake_case) shape of a `FigureRecord`; `unreadable` appears only when true. */
export function toSnapshotRecord(record: FigureRecord): SnapshotRecord {
  return {
    span_days: record.spanDays,
    observations: record.observations,
    crypto: record.crypto,
    ...(record.unreadable ? { unreadable: true as const } : {}),
  };
}

const STRATEGY_REF = z.object({
  // Stored as text — the surrounding system already validates UUIDs at
  // insert time. The snapshot schema's job is shape integrity, not
  // re-validating ids that came back from a trusted DB.
  strategy_id: z.string().min(1),
  strategy_name: z.string(),
  sharpe: z.number().nullable(),
  sharpe_record: SNAPSHOT_RECORD.nullable().optional(),
});

const PORTFOLIO_SNAPSHOT_SCHEMA = z.object({
  sharpe: z.number().nullable(),
  /** The book Sharpe's record (194.1 B12c); see `SNAPSHOT_RECORD`. Absent on a legacy snapshot. */
  sharpe_record: SNAPSHOT_RECORD.nullable().optional(),
  max_drawdown: z.number().nullable(),
  /**
   * Herfindahl-Hirschman on allocation weights. 1/n = perfectly diversified,
   * 1 = single strategy. Null when no weights are set.
   */
  concentration: z.number().nullable(),
  top_3_strategies: z.array(STRATEGY_REF).max(3),
  bottom_3_strategies: z.array(STRATEGY_REF).max(3),
  alerts_last_7d: z.number().int().nonnegative(),
});

export type PortfolioSnapshotJSON = z.infer<typeof PORTFOLIO_SNAPSHOT_SCHEMA>;
export type PortfolioSnapshotStrategy = z.infer<typeof STRATEGY_REF>;

const PORTFOLIO_ANALYTICS_SELECT: string =
  "portfolio_sharpe, portfolio_max_drawdown, curve_start:portfolio_equity_curve->0->>date, curve_end:portfolio_equity_curve->-1->>date";

/**
 * Compute the snapshot for the given user's primary portfolio. The
 * "primary" portfolio is the most-recently-created REAL (`is_test=false`)
 * portfolio — scenario / what-if portfolios saved by the allocator
 * (is_test=true) are excluded so the manager receiving the intro never
 * reads a hypothetical book.
 *
 * Returns a Zod-validated object; throws if the shape is unexpectedly
 * broken — the /api/intro caller catches and treats as failed, not
 * pending.
 *
 * Uses the service-role admin client because this runs server-side after
 * auth + allocator role check has already happened.
 *
 * audit-2026-05-07 G8.E.1 / FIX-LIST P338 — pre-fix, the query did NOT
 * filter on `is_test`. After the v0.4.0 pivot allowed allocators to
 * save what-if scenarios as `is_test=true` portfolios, the "most
 * recently created" pick could land on a scenario book and leak fake
 * KPIs (Sharpe / MaxDD / top-3 / bottom-3) to the manager via
 * `contact_requests.portfolio_snapshot`. The `.eq('is_test', false)`
 * predicate below is the explicit invariant; ordering is incidental.
 */
export async function computePortfolioSnapshot(
  userId: string,
): Promise<PortfolioSnapshotJSON> {
  const admin = createAdminClient();

  // 1. Primary portfolio = most recently created REAL portfolio for
  //    this user. Scenarios (`is_test=true`) are explicitly excluded —
  //    see G8.E.1 docblock above.
  const { data: portfolio, error: portfolioErr } = await admin
    .from("portfolios")
    .select("id")
    .eq("user_id", userId)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (portfolioErr) throw portfolioErr;

  if (!portfolio) {
    // Brand-new allocator with no portfolio. Return a fully-zero snapshot
    // rather than failing — the intro can still go through, the manager just
    // has nothing to read.
    return PORTFOLIO_SNAPSHOT_SCHEMA.parse({
      sharpe: null,
      sharpe_record: null,
      max_drawdown: null,
      concentration: null,
      top_3_strategies: [],
      bottom_3_strategies: [],
      alerts_last_7d: 0,
    });
  }

  const portfolioId = portfolio.id as string;

  // Steps 2-4 are independent of each other — fire them in parallel to
  // save 2 RTTs. Each branch still throws its own error on failure.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [
    { data: analyticsRow, error: analyticsErr },
    { data: strategyLinks, error: strategyLinksErr },
    { count, error: alertsErr },
  ] = await Promise.all([
    admin
      .from("portfolio_analytics")
      // 194.1 B12c: the book's record comes from the first and last equity-curve dates
      // (`->-1` is the last element; typed `string` so postgrest-js does not parse the
      // select at the type level, the same reason as RECORD_SCALAR_ALIASES).
      .select(PORTFOLIO_ANALYTICS_SELECT)
      .eq("portfolio_id", portfolioId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("portfolio_strategies")
      .select(
        `strategy_id, current_weight, allocated_amount, strategies ( id, name, asset_class ), strategy_analytics:strategy_analytics ( strategy_id, sharpe, ${RECORD_SCALAR_ALIASES} )`,
      )
      .eq("portfolio_id", portfolioId),
    admin
      .from("portfolio_alerts")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_id", portfolioId)
      .gte("triggered_at", sevenDaysAgo),
  ]);
  if (analyticsErr) throw analyticsErr;
  if (strategyLinksErr) throw strategyLinksErr;
  if (alertsErr) throw alertsErr;

  const analytics = analyticsRow as unknown as
    | (Pick<PortfolioAnalytics, "portfolio_sharpe" | "portfolio_max_drawdown"> & {
        curve_start?: string | null;
        curve_end?: string | null;
      })
    | null;

  // PostgREST returns embedded relations as arrays even when they are
  // logically 1:1; we collapse to the first element below. Cast through
  // unknown because the runtime shape is what we actually care about.
  type StrategyEmbed = { id: string; name: string; asset_class?: string | null };
  type AnalyticsEmbed = { strategy_id: string; sharpe: number | null } & RecordScalarRow;
  const links = ((strategyLinks ?? []) as unknown) as Array<{
    strategy_id: string;
    current_weight: number | null;
    allocated_amount: number | null;
    strategies: StrategyEmbed | StrategyEmbed[] | null;
    strategy_analytics: AnalyticsEmbed | AnalyticsEmbed[] | null;
  }>;

  function firstOrSingle<T>(value: T | T[] | null): T | null {
    if (value === null) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
  }

  // Concentration (HHI) — defined over current_weight if populated, else
  // allocated_amount normalized, else null.
  const concentration = computeConcentration(
    links.map((l) => ({
      weight: l.current_weight,
      amount: l.allocated_amount,
    })),
  );

  // Top/bottom by Sharpe. Strategies without analytics are omitted from
  // the ranking (null Sharpe tells the manager nothing).
  const ranked: PortfolioSnapshotStrategy[] = links
    .map((l) => {
      const strat = firstOrSingle(l.strategies);
      const sa = firstOrSingle(l.strategy_analytics);
      const name = strat?.name ?? "Unnamed strategy";
      const sharpe = sa?.sharpe ?? null;
      return {
        strategy_id: l.strategy_id,
        strategy_name: name,
        sharpe,
        sharpe_record: toSnapshotRecord(recordFromScalars(sa, strat?.asset_class)),
      };
    })
    .filter((s) => s.sharpe !== null)
    .sort((a, b) => (b.sharpe ?? 0) - (a.sharpe ?? 0));

  const top3 = ranked.slice(0, 3);
  // Bottom 3: reverse sort, take 3, then reverse back so the returned order
  // is still "worst first" (readable in the admin UI).
  const bottom3 = ranked.slice(Math.max(0, ranked.length - 3)).reverse();

  // 194.1 B12c: the book's record. Dates are cut to yyyy-mm-dd (the writer stores
  // `Timestamp.isoformat()`); no observation count exists for a book, so the interim
  // 90-day span rule decides; the crypto basis is the blend rule over every linked leg.
  const bookRecord = figureRecord({
    seriesStart: analytics?.curve_start?.slice(0, 10) ?? null,
    seriesEnd: analytics?.curve_end?.slice(0, 10) ?? null,
    observations: null,
    periodsPerYear: blendPeriodsPerYear(
      links.map((l) => ({ asset_class: firstOrSingle(l.strategies)?.asset_class })),
    ),
  });

  const snapshot: PortfolioSnapshotJSON = {
    sharpe: analytics?.portfolio_sharpe ?? null,
    sharpe_record: toSnapshotRecord(bookRecord),
    max_drawdown: analytics?.portfolio_max_drawdown ?? null,
    concentration,
    top_3_strategies: top3,
    bottom_3_strategies: bottom3,
    alerts_last_7d: count ?? 0,
  };

  return PORTFOLIO_SNAPSHOT_SCHEMA.parse(snapshot);
}

/**
 * HHI on strategy weights. Prefers explicit current_weight (0..1); falls
 * back to normalizing allocated_amount. Returns null when neither source
 * yields a usable total.
 */
function computeConcentration(
  entries: Array<{ weight: number | null; amount: number | null }>,
): number | null {
  if (entries.length === 0) return null;

  const weights = entries
    .map((e) => (typeof e.weight === "number" ? e.weight : null))
    .filter((w): w is number => w !== null && Number.isFinite(w));

  if (weights.length === entries.length) {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total > 0) {
      return weights.reduce((s, w) => s + (w / total) ** 2, 0);
    }
  }

  const amounts = entries
    .map((e) => (typeof e.amount === "number" ? e.amount : null))
    .filter((a): a is number => a !== null && Number.isFinite(a) && a > 0);

  if (amounts.length > 0) {
    const total = amounts.reduce((s, a) => s + a, 0);
    return amounts.reduce((s, a) => s + (a / total) ** 2, 0);
  }

  return null;
}

/** Exposed for /admin/intros + tests. */
export const PortfolioSnapshotSchema = PORTFOLIO_SNAPSHOT_SCHEMA;
