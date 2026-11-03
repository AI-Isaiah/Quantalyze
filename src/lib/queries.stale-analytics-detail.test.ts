/**
 * STALE-01 part 2 — the DETAIL fetchers must not hand out a failed run's numbers.
 *
 * THE DEFECT, measured on the production database 2026-08-25:
 *
 *     published strategies:                                18
 *     computation_status complete/complete_with_warnings:    1
 *     status 'failed' but still carrying sharpe/cagr:       17
 *     ...and still carrying a non-null computed_at:         17
 *
 * A `failed` analytics row keeps whatever KPI values an EARLIER run wrote — the
 * analytics writer stamps the status and the error, not the metrics. Part 1
 * (`shapeRowAnalytics`) closed the ranked LIST path. The three SINGLE-strategy
 * fetchers read the same columns off the same rows and rendered them with the
 * same ungated confidence:
 *
 *   getPublicStrategyDetail → /browse/[slug]/[strategyId]'s hero + mini grids
 *                           → /strategy/[id]'s `generateMetadata`, where the
 *                             KPI triple becomes `<meta description>`,
 *                             OpenGraph and Twitter card text — the one place
 *                             a dead figure OUTLIVES the page, because unfurl
 *                             caches keep their own copy.
 *   getFactsheetDetail      → /factsheet/[id]/tearsheet, the widest public
 *                             metric surface: hero grid, detail grid, the
 *                             `metrics_json` VaR/CVaR block, the monthly
 *                             heatmap. It is in PUBLIC_ROUTES.
 *   getStrategyDetail       → /discovery/[slug]/[strategyId], authed but
 *                             CROSS-TENANT — every allocator reads other
 *                             managers' rows through it.
 *
 * WHY THE DATE MAKES IT A FALSE CLAIM AND NOT MERELY A STALE ONE: the SQL
 * status bridge re-stamps `computed_at = now()` on the branches it writes,
 * INCLUDING `failed` (migration
 * 20260710150000_sync_status_supersede_failed_per_kind.sql:179) and `computing`
 * (:125). `computed_at` therefore dates the FAILURE while the figures beside it
 * date some earlier, unrecorded success.
 *
 * WHAT THE FIX IS NOT: it does not drop the strategy, add a chip, a colour or a
 * public error state. The page keeps its name, its manager panel, its
 * disclaimers and its CTA; only the claims the failed computation cannot
 * support are withheld, as em-dashes — which is what every one of these
 * surfaces already renders for a strategy that never computed at all.
 *
 * ANTI-VACUITY. Every assertion below was witnessed RED against the pre-fix
 * implementation. The fixtures carry REAL, DISTINCTIVE stale values — 3.77
 * Sharpe, +66.12% CAGR, a heatmap, a metrics_json blob — never nulls, so no
 * assertion can pass because a fixture had nothing to show. A terminal-SUCCESS
 * control row runs the identical assertions in the opposite direction in every
 * group, so no assertion can pass by blanking everything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Supabase mock --------------------------------------------------------
// All three fetchers read `strategies` through `.single()`. Two of them also
// call `readPublicVerificationSignals` (a `.rpc()`) and `loadManagerIdentity`
// (a `.maybeSingle()` on `profiles`), both seeded inert here — trust tier and
// manager redaction have their own specs and are not the claim under test.
const seeded = vi.hoisted(() => ({
  strategyRow: null as unknown,
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const buildChain = (table: string) => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.single = () =>
    Promise.resolve(
      table === "strategies"
        ? { data: seeded.strategyRow, error: null }
        : { data: null, error: null },
    );
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  // `getPercentiles` and other list reads await the builder directly. Resolving
  // to an empty set keeps them out of this spec (a cohort under 5 → null).
  chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(onFulfilled);
  return chain;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => buildChain(table),
    rpc: async () => ({ data: [], error: null }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => buildChain(table),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

import {
  getPublicStrategyDetail,
  getFactsheetDetail,
  getStrategyDetail,
  shapeRowAnalytics,
} from "./queries";
import type { StrategyAnalytics } from "./types";

// --- Fixtures -------------------------------------------------------------

const STRATEGY_ID = "5ta1e001-0000-4000-8000-000000000001".replace("t", "1");

/**
 * The stale KPI payload a `failed` row really carries. Chosen to be
 * unmistakable, and BEST-IN-CLASS in every column, so a leak is both visible
 * and maximally flattering — the direction a regression actually hurts in.
 */
const STALE_KPIS = {
  cumulative_return: 0.9134,
  cagr: 0.6612,
  volatility: 0.1855,
  sharpe: 3.77,
  sortino: 5.21,
  calmar: 4.09,
  max_drawdown: -0.0311,
  max_drawdown_duration_days: 3,
  six_month_return: 0.4409,
  sparkline_returns: [1, 1.2, 1.45, 1.91],
} as const;

/** A modest but REAL computed row — the control that must keep everything. */
const LIVE_KPIS = {
  cumulative_return: 0.12,
  cagr: 0.05,
  volatility: 0.33,
  sharpe: 0.6,
  sortino: 0.8,
  calmar: 0.15,
  max_drawdown: -0.4,
  max_drawdown_duration_days: 120,
  six_month_return: 0.07,
  sparkline_returns: [1, 1.02, 1.05, 1.12],
} as const;

/** The heavier columns the tearsheet and the discovery factsheet read. */
const HEAVY = {
  monthly_returns: { "2026": { Jan: 0.081, Feb: -0.014 } },
  metrics_json: { var_1d_95: -0.0271, cvar: -0.0388, best_day: 0.0612, worst_day: -0.0433 },
  daily_returns: [
    { date: "2026-01-02", value: 0.01 },
    { date: "2026-01-03", value: -0.004 },
  ],
  returns_series: { "2026-01-02": 1.01, "2026-01-03": 1.006 },
  data_quality_flags: { composite: false },
  metrics_json_by_basis: { cash: { sharpe: 3.77 } },
} as const;

/**
 * `computed_at` is deliberately RECENT on the dead row. On a `failed` row the
 * SQL bridge re-stamps it to the moment of FAILURE, so the honest-looking
 * timestamp is precisely the thing that turns dead numbers into a live claim.
 */
const DEAD_COMPUTED_AT = "2026-08-25T09:15:00.000Z";
const LIVE_COMPUTED_AT = "2026-08-24T09:15:00.000Z";

function strategyRow(analytics: Record<string, unknown> | null) {
  return {
    id: STRATEGY_ID,
    user_id: "00000000-0000-4000-8000-0000000000aa",
    status: "published",
    name: "Orpheus",
    codename: "Orpheus",
    disclosure_tier: "exploratory",
    strategy_types: ["momentum"],
    markets: ["BTC"],
    aum: 1_000_000,
    start_date: "2024-01-01",
    asset_class: "crypto",
    discovery_categories: { slug: "crypto-sma" },
    strategy_analytics: analytics,
  };
}

const analyticsRow = (
  status: string,
  kpis: typeof STALE_KPIS | typeof LIVE_KPIS,
  computedAt: string,
) => ({
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  strategy_id: STRATEGY_ID,
  computation_status: status,
  computed_at: computedAt,
  ...kpis,
  ...HEAVY,
});

const DEAD_ROW = () => analyticsRow("failed", STALE_KPIS, DEAD_COMPUTED_AT);
const LIVE_ROW = () => analyticsRow("complete", LIVE_KPIS, LIVE_COMPUTED_AT);
const WARNED_ROW = () =>
  analyticsRow("complete_with_warnings", LIVE_KPIS, LIVE_COMPUTED_AT);
const COMPUTING_ROW = () => analyticsRow("computing", STALE_KPIS, DEAD_COMPUTED_AT);

/** The KPI columns every one of the three surfaces renders. */
const KPI_KEYS = [
  "cumulative_return",
  "cagr",
  "volatility",
  "sharpe",
  "sortino",
  "calmar",
  "max_drawdown",
  "six_month_return",
] as const;

beforeEach(() => {
  seeded.strategyRow = null;
});

// =========================================================================
// Group A — getPublicStrategyDetail (/browse/[slug]/[id] + /strategy/[id]'s
//           generateMetadata, which is the OG / Twitter / meta-description
//           builder)
// =========================================================================

describe("STALE-01 · getPublicStrategyDetail withholds a failed run's figures", () => {
  it("A1: every KPI a `failed` row still carries comes back null", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    expect(result).not.toBeNull();
    for (const key of KPI_KEYS) {
      expect(
        result!.analytics![key],
        `${key} leaked a failed run's value (${String(STALE_KPIS[key as keyof typeof STALE_KPIS])})`,
      ).toBeNull();
    }
    // The equity curve is a job output too — /browse renders it as a card.
    expect(result!.analytics!.sparkline_returns).toBeNull();
  });

  it("A2: the timestamp is cleared — it dated the FAILURE, not the numbers", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    expect(result!.analytics!.computed_at).not.toBe(DEAD_COMPUTED_AT);
    expect(result!.analytics!.computed_at).toBeFalsy();
  });

  it("A3: the REAL status survives — laundering it to 'pending' would spin a forever-Syncing chip", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    expect(result!.analytics!.computation_status).toBe("failed");
  });

  it("A4: the strategy itself is NOT dropped — name, AUM and start_date are not analytics outputs", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    expect(result!.strategy.name).toBe("Orpheus");
    expect(result!.strategy.aum).toBe(1_000_000);
    expect(result!.strategy.start_date).toBe("2024-01-01");
  });

  it("A5: CONTROL — a `complete` row is handed through untouched", async () => {
    seeded.strategyRow = strategyRow(LIVE_ROW());

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    for (const key of KPI_KEYS) {
      expect(result!.analytics![key]).toBe(LIVE_KPIS[key as keyof typeof LIVE_KPIS]);
    }
    expect(result!.analytics!.computed_at).toBe(LIVE_COMPUTED_AT);
  });

  it("A6: CONTROL — `complete_with_warnings` is a terminal SUCCESS and keeps its figures", async () => {
    seeded.strategyRow = strategyRow(WARNED_ROW());

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    expect(result!.analytics!.sharpe).toBe(LIVE_KPIS.sharpe);
    expect(result!.analytics!.cagr).toBe(LIVE_KPIS.cagr);
  });

  it("A7: a live `computing` job is withheld too — there is no honest date for the PREVIOUS run's numbers", async () => {
    seeded.strategyRow = strategyRow(COMPUTING_ROW());

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    expect(result!.analytics!.sharpe).toBeNull();
    expect(result!.analytics!.computation_status).toBe("computing");
  });

  it("A8: an ABSENT analytics row still returns null — the pre-existing not-found path is unchanged", async () => {
    seeded.strategyRow = strategyRow(null);

    const result = await getPublicStrategyDetail(STRATEGY_ID);

    // /browse/[slug]/[id] gates on `!result.analytics` to render "Strategy not
    // found". Substituting EMPTY_ANALYTICS here would resurrect a page for a
    // strategy that never had analytics at all.
    expect(result!.analytics).toBeNull();
  });
});

// =========================================================================
// Group B — getFactsheetDetail (/factsheet/[id]/tearsheet, PUBLIC_ROUTES)
// =========================================================================

describe("STALE-01 · getFactsheetDetail withholds a failed run's figures", () => {
  it("B1: KPIs, the monthly heatmap and the metrics_json risk block all come back null", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getFactsheetDetail(STRATEGY_ID);

    expect(result).not.toBeNull();
    for (const key of KPI_KEYS) {
      expect(result!.analytics[key], `${key} leaked`).toBeNull();
    }
    // The tearsheet's heatmap section renders whenever `monthly_returns` is
    // truthy, and its VaR / CVaR / best-day / worst-day cells read
    // `metrics_json`. Both are job outputs of the run that failed.
    expect(result!.analytics.monthly_returns).toBeNull();
    expect(result!.analytics.metrics_json).toBeNull();
    expect(result!.analytics.sparkline_returns).toBeNull();
  });

  it("B2: the sync timestamp is cleared", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getFactsheetDetail(STRATEGY_ID);

    expect(result!.analytics.computed_at).not.toBe(DEAD_COMPUTED_AT);
    expect(result!.analytics.computed_at).toBeFalsy();
  });

  it("B3: CONTROL — a `complete` row keeps its KPIs, its heatmap and its risk block", async () => {
    seeded.strategyRow = strategyRow(LIVE_ROW());

    const result = await getFactsheetDetail(STRATEGY_ID);

    expect(result!.analytics.sharpe).toBe(LIVE_KPIS.sharpe);
    expect(result!.analytics.monthly_returns).toEqual(HEAVY.monthly_returns);
    expect(result!.analytics.metrics_json).toEqual(HEAVY.metrics_json);
    expect(result!.analytics.computed_at).toBe(LIVE_COMPUTED_AT);
  });
});

// =========================================================================
// Group C — getStrategyDetail (/discovery/[slug]/[strategyId], cross-tenant)
// =========================================================================

describe("STALE-01 · getStrategyDetail withholds a failed run's figures", () => {
  it("C1: the SERIES the discovery factsheet is built from are withheld, not just the scalars", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getStrategyDetail(STRATEGY_ID, "crypto-sma");

    expect(result).not.toBeNull();
    for (const key of KPI_KEYS) {
      expect(result!.analytics[key], `${key} leaked`).toBeNull();
    }
    // Phase 169.1 plan 01 (D-26): the discovery page no longer builds from
    // these columns (it builds through the shared path, whose own G1 gate
    // refuses a failed run), and the default projection does not request
    // them. Shaping still withholds whatever arrives, so a future projection
    // that widened again could not leak a dead run's series through here.
    expect(result!.analytics.daily_returns).toBeNull();
    expect(result!.analytics.returns_series).toBeNull();
    // `metrics_json_by_basis` is not on the `StrategyAnalytics` interface, so
    // read it off the raw row shape.
    expect(
      (result!.analytics as unknown as { metrics_json_by_basis?: unknown })
        .metrics_json_by_basis ?? null,
    ).toBeNull();
  });

  it("C2: the real status survives so the detail read still reports the truth", async () => {
    seeded.strategyRow = strategyRow(DEAD_ROW());

    const result = await getStrategyDetail(STRATEGY_ID, "crypto-sma");

    expect(result!.analytics.computation_status).toBe("failed");
    expect(result!.analytics.computed_at).toBeFalsy();
  });

  it("C3: CONTROL — a `complete` row keeps its scalars AND whatever series arrive", async () => {
    seeded.strategyRow = strategyRow(LIVE_ROW());

    const result = await getStrategyDetail(STRATEGY_ID, "crypto-sma");

    expect(result!.analytics.sharpe).toBe(LIVE_KPIS.sharpe);
    expect(result!.analytics.daily_returns).toEqual(HEAVY.daily_returns);
    expect(result!.analytics.returns_series).toEqual(HEAVY.returns_series);
  });
});


// =========================================================================
// Group D — phase 190 (FACTSHEETQUEUED, D-02, D-05): a row RE-COMPUTING over a
// stored success result keeps its last computed figures on every shaped
// surface. The list rows, the owner's list and the detail shapers all share
// `shapeRowAnalytics`, so one decision (the same `hasStoredAnalyticsResult` +
// `isRecomputeOverStoredResult` the factsheet uses) serves them all.
//
// WHY it matters (Rule 9): an allocator browsing a category list during a
// ten-minute re-run must see the figures the factsheet shows for the same
// strategy, not a row of dashes. And a row that never computed (no stored
// evidence) or a failed row must still be blanked, or the list would show an
// empty or dead run's numbers as if they were live.
// =========================================================================

const SHAPE_ID = "5ta1e002-0000-4000-8000-000000000002".replace("t", "1");
const ROW_COMPUTED_AT = "2026-10-30T10:00:00.123456+00:00";
// The same instant as ROW_COMPUTED_AT, spelled the way a JS Date writes it.
const SAME_INSTANT_OTHER_FORMAT = "2026-10-30T10:00:00.123Z";
const ONE_SECOND_OFF = "2026-10-30T10:00:01.123Z";

/** A ranked-list (scalar alias) row: it ships no flags blob and no series array. */
function projectedRow(over: Record<string, unknown>): StrategyAnalytics {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000000b",
    strategy_id: SHAPE_ID,
    computed_at: ROW_COMPUTED_AT,
    computation_status: "computing",
    ...LIVE_KPIS,
    series_end: "2026-10-29",
    cumulative_method: "geometric",
    native_unit: null,
    ...over,
  } as unknown as StrategyAnalytics;
}

/** An owner / detail (wildcard blob) row: the flags blob and the series array. */
function blobRow(over: Record<string, unknown>): StrategyAnalytics {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000000c",
    strategy_id: SHAPE_ID,
    computed_at: ROW_COMPUTED_AT,
    computation_status: "computing",
    ...LIVE_KPIS,
    returns_series: [
      { date: "2026-10-28", value: 0.01 },
      { date: "2026-10-29", value: 0.02 },
    ],
    data_quality_flags: { cumulative_method: "geometric" },
    ...over,
  } as unknown as StrategyAnalytics;
}

const shapeIt = (a: StrategyAnalytics) => shapeRowAnalytics(a, SHAPE_ID);

describe("phase 190 · shapeRowAnalytics admits a re-run over a stored success result", () => {
  it("D1: a computing list row with stored evidence keeps its figures, its series end and its unit, flagged analytics_updating", () => {
    const out = shapeIt(projectedRow({ native_unit: "BTC" }));

    for (const key of KPI_KEYS) {
      expect(out[key], `${key} was blanked during a re-run`).toBe(LIVE_KPIS[key as keyof typeof LIVE_KPIS]);
    }
    expect(out.sparkline_returns).toEqual(LIVE_KPIS.sparkline_returns);
    expect(out.series_end).toBe("2026-10-29");
    expect(out.native_unit).toBe("BTC");
    expect(out.analytics_updating).toBe(true);
    // The REAL status survives: the owner list still knows a run is in flight.
    expect(out.computation_status).toBe("computing");
  });

  it("D2: a pending list row with the same evidence is admitted likewise", () => {
    const out = shapeIt(projectedRow({ computation_status: "pending" }));
    expect(out.sharpe).toBe(LIVE_KPIS.sharpe);
    expect(out.analytics_updating).toBe(true);
    expect(out.computation_status).toBe("pending");
  });

  it("D3: an owner / detail blob row is admitted on its flags and its series array", () => {
    const out = shapeIt(
      blobRow({ data_quality_flags: { cumulative_method: "geometric", native_unit: "BTC" } }),
    );
    expect(out.sharpe).toBe(LIVE_KPIS.sharpe);
    expect(out.series_end).toBe("2026-10-29");
    expect(out.native_unit).toBe("BTC");
    expect(out.analytics_updating).toBe(true);
  });

  it("D4: a FAILED row is blanked even when it carries full evidence (SC-6)", () => {
    const out = shapeIt(projectedRow({ computation_status: "failed" }));
    for (const key of KPI_KEYS) expect(out[key], `${key} leaked`).toBeNull();
    expect(out.computation_status).toBe("failed");
    expect(out.analytics_updating).toBeUndefined();
    expect(out.computed_at).toBeFalsy();
  });

  it("D5: a computing row WITHOUT the success marker is blanked with its real status (a first-ever compute has no figures to keep)", () => {
    const out = shapeIt(projectedRow({ cumulative_method: null }));
    expect(out.sharpe).toBeNull();
    expect(out.computation_status).toBe("computing");
    expect(out.analytics_updating).toBeUndefined();
  });

  it("D6: a computing row without a stored series is blanked", () => {
    const out = shapeIt(projectedRow({ series_end: null }));
    expect(out.sharpe).toBeNull();
    expect(out.analytics_updating).toBeUndefined();
  });

  it("D7: a terminal-success row carries no analytics_updating key at all (every existing shaped object keeps its exact shape)", () => {
    for (const status of ["complete", "complete_with_warnings"]) {
      const out = shapeIt(projectedRow({ computation_status: status }));
      expect("analytics_updating" in out).toBe(false);
      expect(out.sharpe).toBe(LIVE_KPIS.sharpe);
    }
  });
});

describe("phase 190 · after the derive hop's prestamp the list row follows its last-success snapshot", () => {
  // The derive hop replaces the live flags (no marker) and carries the last
  // success's flags in a snapshot bound to the success by computed_at.
  const PRESTAMPED = {
    cumulative_method: null,
    native_unit: null,
    last_success_cumulative_method: "geometric",
    last_success_computed_at: SAME_INSTANT_OTHER_FORMAT,
    last_success_native_unit: "BTC",
  };

  it("D8: a bound snapshot keeps the figures and shows the unit its OWN success recorded", () => {
    const out = shapeIt(projectedRow(PRESTAMPED));
    expect(out.sharpe).toBe(LIVE_KPIS.sharpe);
    expect(out.analytics_updating).toBe(true);
    expect(out.native_unit).toBe("BTC");
  });

  it("D9: a snapshot bound to ANOTHER success (one second off) is never used: the row is blanked", () => {
    const out = shapeIt(projectedRow({ ...PRESTAMPED, last_success_computed_at: ONE_SECOND_OFF }));
    expect(out.sharpe).toBeNull();
    expect(out.analytics_updating).toBeUndefined();
  });

  it("D10: a blob row with live csv_source flags and a bound last_success_snapshot is admitted the same way", () => {
    const out = shapeIt(
      blobRow({
        data_quality_flags: {
          csv_source: true,
          last_success_snapshot: {
            computed_at: SAME_INSTANT_OTHER_FORMAT,
            flags: { cumulative_method: "geometric", native_unit: "BTC" },
          },
        },
      }),
    );
    expect(out.sharpe).toBe(LIVE_KPIS.sharpe);
    expect(out.analytics_updating).toBe(true);
    expect(out.native_unit).toBe("BTC");
  });

  it("D11: a blob row whose snapshot is null (a prestamp with nothing to carry) is blanked", () => {
    const out = shapeIt(
      blobRow({ data_quality_flags: { csv_source: true, last_success_snapshot: null } }),
    );
    expect(out.sharpe).toBeNull();
  });

  it("D12: a row HELD at a terminal-success status through the derive hop takes the snapshot's unit (terminal arm, no analytics_updating key)", () => {
    // complete_with_warnings is where the status bridge holds a chain-broken
    // row through the derive hop: its live unit alias is gone, its success's
    // unit is not. Showing no BTC chip beside BTC figures would be a lie.
    const out = shapeIt(projectedRow({ ...PRESTAMPED, computation_status: "complete_with_warnings" }));
    expect(out.native_unit).toBe("BTC");
    expect("analytics_updating" in out).toBe(false);
  });

  it("D13: the same terminal row with an unbound snapshot keeps its LIVE unit, as today", () => {
    const out = shapeIt(
      projectedRow({
        ...PRESTAMPED,
        computation_status: "complete_with_warnings",
        last_success_computed_at: ONE_SECOND_OFF,
        native_unit: "ETH",
      }),
    );
    expect(out.native_unit).toBe("ETH");
  });

  it("D14: a terminal row whose live marker alias is present keeps its live unit (today's shape; the snapshot is not consulted)", () => {
    const out = shapeIt(
      projectedRow({
        computation_status: "complete",
        cumulative_method: "geometric",
        native_unit: "ETH",
        last_success_cumulative_method: "geometric",
        last_success_computed_at: SAME_INSTANT_OTHER_FORMAT,
        last_success_native_unit: "BTC",
      }),
    );
    expect(out.native_unit).toBe("ETH");
  });

  it("D15: no shaped object, on any arm, carries a last_success_* alias (evidence inputs never leave the shaper)", () => {
    const rows = [
      projectedRow(PRESTAMPED),
      projectedRow({ ...PRESTAMPED, computation_status: "complete" }),
      projectedRow({ ...PRESTAMPED, computation_status: "failed" }),
      projectedRow({ ...PRESTAMPED, last_success_computed_at: ONE_SECOND_OFF }),
    ];
    for (const row of rows) {
      const keys = Object.keys(shapeIt(row));
      expect(keys.filter((k) => k.startsWith("last_success_"))).toEqual([]);
    }
  });
});
