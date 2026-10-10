/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";

// composite-read-path imports `server-only` (a Next.js build guard that throws
// outside an RSC bundle). Stub it, as composite-read-path.test.ts does.
vi.mock("server-only", () => ({}));
// The both-surfaces case (Task 2) drives the two REAL callers: the factsheet
// route's builder and the discovery detail page. Their data sources are stubbed;
// the assembly under test is not. Mirrors the two page.smoothed-wiring harnesses.
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
  redirect: (url: string) => {
    throw new Error(`redirect(${url}) called`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getStrategyDetail: vi.fn() }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSingleKeyBasisOpts, singleKeyDataQuality } from "./composite-read-path";
import { buildFactsheetPayload } from "./build-payload";
import { compute, recordCoversWindow } from "./compute";
import { annualizationPeriods } from "@/lib/closed-sets";
import type { BuildFactsheetOpts } from "./build-payload";
import { fetchAndBuildPayload } from "./fetch-and-build-payload";
import type { DailyReturn, FactsheetPayload } from "./types";
import StrategyDetailPage from "@/app/(dashboard)/discovery/[slug]/[strategyId]/page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrategyDetail } from "@/lib/queries";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { captureToSentry } from "@/lib/sentry-capture";

/**
 * Phase 169 (SC4, D-10, D-25) — where the factsheet's headline CAGR and Sharpe
 * come from for a SINGLE-KEY strategy.
 *
 * Discovery, recommendations and my-strategies show the Python-persisted
 * `strategy_analytics` scalars. Until this phase the factsheet recomputed its
 * headline in TypeScript and overlaid the persisted values only for composites,
 * so the same strategy could read one Sharpe in the list and another on its own
 * page. The founder rule (D-25) is "calculate Sharpe once; every page reads
 * it". These tests run the REAL owner (`readSingleKeyBasisOpts`) into the REAL
 * builder (`buildFactsheetPayload`), then through a JSON round trip as the
 * payload cache does (NaN becomes null), and pin that the page reads the stored
 * number whenever the row is rankable, and keeps today's value when it is not.
 *
 * The persisted CAGR / Sharpe are deliberately NOT the values the TypeScript
 * computation gives over the same series (asserted below), so a test that
 * passes cannot be passing because the two happen to agree.
 */

function isoDay(i: number, start = Date.UTC(2024, 0, 1)): string {
  return new Date(start + i * 86_400_000).toISOString().slice(0, 10);
}

/** 400 clean (unbroken) days of both signs: losing days and a drawdown exist. */
const SERIES: DailyReturn[] = Array.from({ length: 400 }, (_, i) => ({
  date: isoDay(i),
  value: Math.sin(i / 7) * 0.01 + 0.0004,
}));

const STRATEGY = {
  id: "headline-source-test",
  name: "Headline Source Test",
  types: ["test"],
  markets: ["crypto"],
  computedAt: "2026-09-29T00:00:00Z",
  trustTier: null,
  ingestSource: "csv" as const,
  assetClass: "crypto",
};

/** Round-trips the payload through JSON, as the payload cache does (NaN → null). */
function viaCache(p: FactsheetPayload): FactsheetPayload {
  return JSON.parse(JSON.stringify(p)) as FactsheetPayload;
}

/** The TypeScript-only headline: the builder with no persisted overlay. */
const CLIENT = viaCache(buildFactsheetPayload(STRATEGY, SERIES)!);

/**
 * RESEARCH Pitfall 1: on a CLEAN series the persisted `cumulative_return` equals
 * the chart's endpoint. The fixture is built to that invariant, and the rankable
 * case asserts it on the rendered payload.
 */
const CHART_END_CUM = CLIENT.strategyEquity[CLIENT.strategyEquity.length - 1] - 1;

/** A single-key, non-options analytics row as the resolve stage projects it. */
function analyticsRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    computation_status: "complete",
    metrics_json_by_basis: null,
    data_quality_flags: {},
    cumulative_return: CHART_END_CUM,
    volatility: 0.31,
    max_drawdown: -0.22,
    cagr: 0.12,
    sharpe: 1.5,
    sortino: 2.0,
    calmar: 0.55,
    ...over,
  };
}

/** The single-key headline arm reads nothing: constructing the admin handle is a defect. */
const neverAdmin = vi.fn((): SupabaseClient => {
  throw new Error("the persisted-headline arm must not construct the service-role handle");
});

/** Drives the shared owner, then the builder, exactly as both factsheet surfaces do. */
async function headlineFor(row: Record<string, unknown>): Promise<FactsheetPayload> {
  const basisOpts = await readSingleKeyBasisOpts(
    neverAdmin,
    STRATEGY.id,
    row.data_quality_flags as { mtm_gated_reason?: unknown } | null,
    row.metrics_json_by_basis,
    row.computation_status,
    row,
  );
  const opts: BuildFactsheetOpts = {
    dataQuality: singleKeyDataQuality(row.data_quality_flags as { insufficient_window?: unknown }),
    ...basisOpts,
  };
  return viaCache(buildFactsheetPayload(STRATEGY, SERIES, opts)!);
}

describe("169 D-10 / SC4 — the single-key factsheet headline reads the persisted scalars", () => {
  it("fixture guard: the TypeScript CAGR and Sharpe differ from the persisted ones", () => {
    // If these ever agree, every equality below passes for the wrong reason.
    expect(Math.abs(CLIENT.strategyMetrics.cagr - 0.12)).toBeGreaterThan(0.01);
    expect(Math.abs(CLIENT.strategyMetrics.sharpe - 1.5)).toBeGreaterThan(0.01);
  });

  it.each(["complete", "complete_with_warnings"])(
    "rankable row (%s): the payload's CAGR and Sharpe EQUAL the persisted values the lists show",
    async (status) => {
      const row = analyticsRow({ computation_status: status });
      const p = await headlineFor(row);
      expect(p.strategyMetrics.cagr).toBe(0.12);
      expect(p.strategyMetrics.sharpe).toBe(1.5);
      // The other five overlaid scalars come from the same stored row.
      expect(p.strategyMetrics.sortino).toBe(2.0);
      expect(p.strategyMetrics.calmar).toBe(0.55);
      expect(p.strategyMetrics.ann_vol).toBe(0.31);
      expect(p.strategyMetrics.max_dd).toBe(-0.22);
      expect(p.strategyMetrics.cum_ret).toBe(row.cumulative_return);
      expect(neverAdmin).not.toHaveBeenCalled();
    },
  );

  it.each(["failed", "computing", null])(
    "row that is not rankable (%s): no overlay, the TypeScript values stand as today",
    async (status) => {
      // A failed run leaves the previous run's scalars behind; they must not render.
      const p = await headlineFor(analyticsRow({ computation_status: status }));
      expect(p.strategyMetrics.cagr).toBe(CLIENT.strategyMetrics.cagr);
      expect(p.strategyMetrics.sharpe).toBe(CLIENT.strategyMetrics.sharpe);
      expect(p.metricsByBasis).toBeUndefined();
    },
  );

  it("a persisted null Sharpe renders the em-dash (strict overlay), never the TypeScript value", async () => {
    const p = await headlineFor(analyticsRow({ sharpe: null }));
    // NaN before the cache, null after it: both format as "—".
    expect(p.strategyMetrics.sharpe).toBeNull();
    expect(p.strategyMetrics.cagr).toBe(0.12);
  });

  it("a row whose scalar columns were not projected keeps the TypeScript values (no seven em-dashes)", async () => {
    const row = analyticsRow();
    for (const k of ["cumulative_return", "volatility", "max_drawdown", "cagr", "sharpe", "sortino", "calmar"]) {
      delete row[k];
    }
    const p = await headlineFor(row);
    expect(p.strategyMetrics.cagr).toBe(CLIENT.strategyMetrics.cagr);
    expect(p.strategyMetrics.sharpe).toBe(CLIENT.strategyMetrics.sharpe);
  });

  /**
   * Review round 1, WR-01 / SFH M-1. The second gate needed a FINITE stored
   * `cumulative_return`, so a rankable row whose stored value is null (Python
   * `_safe_float` persists null for a non-finite value) fell back to the WHOLE
   * TypeScript headline, CAGR and Sharpe included, while the lists show the
   * stored ones: the SC4 split D-25 removes. The gate is now structural (the
   * seven keys present); a null stored value renders "—" under the strict
   * overlay, as the lists do, and the defect reaches Sentry.
   */
  it("WR-01: a rankable row with a null stored cumulative return still renders the stored CAGR and Sharpe", async () => {
    vi.mocked(captureToSentry).mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const p = await headlineFor(analyticsRow({ cumulative_return: null }));
      expect(p.strategyMetrics.sharpe, "fell back to the TypeScript Sharpe").toBe(1.5);
      expect(p.strategyMetrics.cagr, "fell back to the TypeScript CAGR").toBe(0.12);
      // NaN before the cache, null after it: the em-dash, never the TypeScript value.
      expect(p.strategyMetrics.cum_ret).toBeNull();
      // A rankable row storing no cumulative return is a data defect: captured once, at warning.
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toMatchObject({
        level: "warning",
        tags: { reason: "non_finite_cumulative_return", strategy_id: STRATEGY.id },
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("WR-01: a lone stored null Sortino is legitimate (no losing day) and captures nothing", async () => {
    vi.mocked(captureToSentry).mockClear();
    const p = await headlineFor(analyticsRow({ sortino: null }));
    expect(p.strategyMetrics.sortino).toBeNull();
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("WR-01: an unprojected headline is refused with its real cause, and the refusal reaches Sentry", async () => {
    vi.mocked(captureToSentry).mockClear();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const row = analyticsRow();
      delete row.sharpe;
      delete row.calmar;
      const p = await headlineFor(row);
      expect(p.strategyMetrics.sharpe).toBe(CLIENT.strategyMetrics.sharpe);
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toMatchObject({
        tags: { reason: "missing_keys", strategy_id: STRATEGY.id },
        extra: { missing: ["sharpe", "calmar"] },
      });
    } finally {
      err.mockRestore();
    }
  });

  it("SFH M-1: a lingering raw cash_settlement object is declined with a warning naming the strategy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const p = await headlineFor(analyticsRow({ metrics_json_by_basis: { cash_settlement: { sharpe: 9 } } }));
      expect(p.strategyMetrics.sharpe).toBe(CLIENT.strategyMetrics.sharpe);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("cash_settlement"),
        expect.objectContaining({ strategyId: STRATEGY.id }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("SFH-01: a CHAIN-BROKEN row whose raw cash_settlement object blocks the stored headline is Withheld, and nothing whole-record leaks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const p = await headlineFor(
        analyticsRow({
          metrics_json_by_basis: { cash_settlement: { sharpe: 9 } },
          data_quality_flags: { twr_chain_broken: true, headline_since: isoDay(388), dust_nav_guard: true },
        }),
      );
      expect(p.dataQuality?.headlineWithheld).toBe(true);
      expect(p.dataQuality?.headlineCoversFrom).toBeUndefined();
      expect(p.dataQuality?.headlineGuardReasons).toEqual(["dust_nav"]);
      // The seven headline figures and the seven windows read null, not the TypeScript whole record.
      const m = p.strategyMetrics as unknown as Record<string, number | null>;
      for (const k of ["cum_ret", "cagr", "ann_vol", "max_dd", "sharpe", "sortino", "calmar"]) {
        expect(m[k], k).toBeNull();
      }
      for (const k of ["mtd", "ytd", "p3m", "p6m", "p1y", "p3y", "p5y"]) expect(m[k], k).toBeNull();
      // The raw-object refusal still logs, naming the strategy.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("cash_settlement"),
        expect.objectContaining({ strategyId: STRATEGY.id }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("RESEARCH Pitfall 1: on a clean series the persisted cumulative return equals the chart endpoint", async () => {
    const p = await headlineFor(analyticsRow());
    const chartEnd = p.strategyEquity[p.strategyEquity.length - 1] - 1;
    expect(p.strategyMetrics.cum_ret).toBeCloseTo(chartEnd, 12);
  });
});

/**
 * D-10 "one shared owner, two callers": the factsheet route (through
 * `fetchAndBuildPayload`'s resolve stage) and the discovery detail page (through
 * its own assembly, until Phase 169.1 plan 169.1-01 consolidates it) must both hand
 * the analytics row to `readSingleKeyBasisOpts`. Same row in, same CAGR and Sharpe
 * out, and both equal to what the lists show. A caller that stops passing the row
 * falls back to the TypeScript headline and reddens this case.
 */
describe("169 D-10 — both factsheet surfaces render the persisted CAGR and Sharpe", () => {
  const STRATEGY_ID = "55555555-5555-4555-8555-555555555555";

  function strategyColumns() {
    return {
      id: STRATEGY_ID,
      name: "Headline Source Test",
      codename: null,
      disclosure_tier: "exploratory",
      status: "published",
      markets: ["BTC"],
      strategy_types: ["test"],
      description: null,
      subtypes: [],
      supported_exchanges: ["binance"],
      leverage_range: null,
      aum: null,
      max_capacity: null,
      avg_daily_turnover: null,
      start_date: null,
      benchmark: null,
      asset_class: "crypto",
      trust_tier: "api_verified",
      returns_denominator_config: null,
    };
  }

  /** The one analytics row both surfaces receive. */
  function sharedAnalyticsRow() {
    return {
      ...analyticsRow(),
      daily_returns: SERIES,
      returns_series: null,
      computed_at: "2026-09-29T00:00:00.000Z",
    };
  }

  /** Admin stub: the route's `strategies` read returns the row; any other read is empty. */
  function mockAdmin(): SupabaseClient {
    const from = (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        abortSignal: () => chain,
        maybeSingle: () =>
          Promise.resolve(
            table === "strategies"
              ? { data: { ...strategyColumns(), strategy_analytics: sharedAnalyticsRow() }, error: null }
              : { data: null, error: null },
          ),
      };
      return chain;
    };
    return { from } as unknown as SupabaseClient;
  }

  /** Depth-first search of an RSC element tree for the FactsheetView payload prop. */
  function findPayload(node: unknown): FactsheetPayload | null {
    if (node == null || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findPayload(child);
        if (hit) return hit;
      }
      return null;
    }
    const el = node as { props?: { payload?: unknown; children?: unknown } };
    if (el.props?.payload != null) return el.props.payload as FactsheetPayload;
    return findPayload(el.props?.children ?? null);
  }

  it("same row through both call shapes → equal CAGR and Sharpe, and both equal the persisted values", async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin() as never);
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
    } as never);
    vi.mocked(getStrategyDetail).mockResolvedValue({
      strategy: strategyColumns(),
      analytics: sharedAnalyticsRow(),
      disclosureTier: "exploratory",
    } as never);

    const route = await fetchAndBuildPayload(STRATEGY_ID, (q) => q);
    const discovery = findPayload(
      await StrategyDetailPage({
        params: Promise.resolve({ slug: DISCOVERY_CATEGORIES[0]!.slug, strategyId: STRATEGY_ID }),
      }),
    );
    expect(route, "factsheet route payload").not.toBeNull();
    expect(discovery, "discovery detail payload").not.toBeNull();

    expect(route!.strategyMetrics.cagr).toBe(0.12);
    expect(route!.strategyMetrics.sharpe).toBe(1.5);
    expect(discovery!.strategyMetrics.cagr).toBe(route!.strategyMetrics.cagr);
    expect(discovery!.strategyMetrics.sharpe).toBe(route!.strategyMetrics.sharpe);
  });
});

/**
 * Review round 1, SFH H-2. A single-key strategy with a
 * `returns_denominator_config` (the allocated-capital override, `simple` +
 * `active`) is computed by the Python runner under that config: a `simple`
 * stored `cumulative_return` is the SUM of the daily returns and its CAGR /
 * Calmar / max drawdown are arithmetic. The single-key arm never resolved
 * `cumulativeMethod` (only the composite reader did), so the page overlaid
 * that arithmetic headline on a geometric equity curve and the two drifted
 * apart with every period. The single-key owner now resolves the method with
 * the composite's own rule, so the chart the page draws agrees with its
 * stored "Since Inception".
 */
describe("169 SFH H-2 — a single-key allocated-capital strategy draws the curve its stored headline was computed on", () => {
  const STRATEGY_ID = "66666666-6666-4666-8666-666666666666";
  const SIMPLE_CONFIG = {
    denominator: "allocated_capital",
    pnl_basis: "cash_settlement",
    metrics_basis: "active_day",
    cumulative_method: "simple",
    capital_schedule: [{ effective_from: "2024-01-01", capital_usd: 1_000_000 }],
  };
  /** Python's `simple` cumulative return: the plain sum of the daily returns. */
  const SUM = SERIES.reduce((acc, d) => acc + d.value, 0);

  function mockAdmin(config: unknown): SupabaseClient {
    const from = (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        abortSignal: () => chain,
        maybeSingle: () =>
          Promise.resolve(
            table === "strategies"
              ? {
                  data: {
                    id: STRATEGY_ID,
                    name: "Allocated Capital Test",
                    codename: null,
                    disclosure_tier: "exploratory",
                    status: "published",
                    markets: ["BTC"],
                    strategy_types: ["test"],
                    description: null,
                    subtypes: [],
                    supported_exchanges: ["binance"],
                    leverage_range: null,
                    aum: null,
                    max_capacity: null,
                    avg_daily_turnover: null,
                    start_date: null,
                    benchmark: null,
                    asset_class: "crypto",
                    returns_denominator_config: config,
                    strategy_analytics: {
                      ...analyticsRow({ cumulative_return: SUM }),
                      daily_returns: SERIES,
                      returns_series: null,
                      computed_at: "2026-09-29T00:00:00.000Z",
                    },
                  },
                  error: null,
                }
              : { data: null, error: null },
          ),
      };
      return chain;
    };
    return { from } as unknown as SupabaseClient;
  }

  it("fixture guard: the sum and the compounded product differ, so agreement cannot be an accident", () => {
    const product = SERIES.reduce((acc, d) => acc * (1 + d.value), 1) - 1;
    expect(Math.abs(product - SUM)).toBeGreaterThan(0.001);
  });

  it("the payload's equity curve ends at the stored simple cumulative return", async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(SIMPLE_CONFIG) as never);
    const p = await fetchAndBuildPayload(STRATEGY_ID, (q) => q);
    expect(p, "payload").not.toBeNull();
    expect(p!.strategyMetrics.cum_ret).toBe(SUM);
    const chartEnd = p!.strategyEquity[p!.strategyEquity.length - 1] - 1;
    expect(chartEnd, "the curve compounds while the stored headline sums").toBeCloseTo(SUM, 12);
  });

  it("CONTROL: with no config the curve stays geometric", async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(null) as never);
    const p = await fetchAndBuildPayload(STRATEGY_ID, (q) => q);
    const product = SERIES.reduce((acc, d) => acc * (1 + d.value), 1) - 1;
    const chartEnd = p!.strategyEquity[p!.strategyEquity.length - 1] - 1;
    expect(chartEnd).toBeCloseTo(product, 12);
  });

  it("SFH M-2: a config the re-derive cannot reproduce marks the payload, so the leverage what-if is withheld", async () => {
    const row = analyticsRow();
    const simple = await readSingleKeyBasisOpts(neverAdmin, "s", {}, null, "complete", row, SIMPLE_CONFIG);
    expect(simple.dataQuality).toEqual({ composite: false, insufficientWindow: false, returnsConventionOverride: true });
    // An active-day Sharpe on a geometric sum is a convention TypeScript does not compute either.
    const active = await readSingleKeyBasisOpts(neverAdmin, "s", {}, null, "complete", row, {
      ...SIMPLE_CONFIG,
      cumulative_method: "geometric",
    });
    expect(active.dataQuality?.returnsConventionOverride).toBe(true);
    expect("cumulativeMethod" in active).toBe(false);
    // Geometric + calendar-day is the TypeScript convention: nothing to mark.
    const calendar = await readSingleKeyBasisOpts(neverAdmin, "s", {}, null, "complete", row, {
      ...SIMPLE_CONFIG,
      cumulative_method: "geometric",
      metrics_basis: "calendar_day",
    });
    expect("dataQuality" in calendar).toBe(false);
  });

  it("the single-key owner resolves the method with the composite's rule", async () => {
    const row = analyticsRow();
    const simple = await readSingleKeyBasisOpts(neverAdmin, "s", {}, null, "complete", row, SIMPLE_CONFIG);
    expect(simple.cumulativeMethod).toBe("arithmetic");
    const none = await readSingleKeyBasisOpts(neverAdmin, "s", {}, null, "complete", row, null);
    expect("cumulativeMethod" in none).toBe(false);
  });
});

/**
 * Phase 164.6.6.3.3 plan 08 (D-01 "window returns", D-12, T-164.6.6.3.3-11).
 *
 * The Returns panel's trailing windows are computed in TypeScript over the whole
 * record and are NOT overlaid from the stored scalars. Beside suffix figures
 * (every stored headline scalar of a Dated row covers the post-break span only)
 * they would be the mixed basis D-01 forbids. On a Dated row they are recomputed
 * on the same suffix. The oracle here slices the series ITSELF and calls
 * `compute()`, so it does not borrow the builder's slice index.
 *
 * D-12: a 12-day suffix on a 400-day record leaves 3 Month and 6 Month with no
 * coverage, so they are null ("—"), never the whole-record value.
 */
describe("164.6.6.3.3 plan 08 — a Dated row's trailing windows cover the suffix", () => {
  const SUFFIX_START = 388; // days 388..399 = a 12-day suffix
  const WINDOW_KEYS = ["mtd", "ytd", "p3m", "p6m", "p1y", "p3y", "p5y"] as const;
  /** Stored cash headline: seven finite scalars, deliberately unlike the TS values. */
  const STORED = {
    cumulative_return: 0.0,
    volatility: 0.0,
    max_drawdown: 0.0,
    cagr: 0.0,
    sharpe: null,
    sortino: null,
    calmar: null,
  };
  const dated = {
    composite: false,
    insufficientWindow: false,
    twrChainBroken: true,
    headlineCoversFrom: isoDay(SUFFIX_START),
  };

  function build(dataQuality: BuildFactsheetOpts["dataQuality"]): FactsheetPayload {
    return viaCache(
      buildFactsheetPayload(STRATEGY, SERIES, {
        dataQuality,
        metricsByBasis: { cash_settlement: STORED },
      } as BuildFactsheetOpts)!,
    );
  }

  const suffix = SERIES.slice(SUFFIX_START);
  const onSuffix = compute(
    suffix.map((d) => d.value),
    suffix.map((d) => d.date),
    0,
    annualizationPeriods("crypto"),
    { cumulativeMethod: "geometric" },
  );

  it("fixture guard: whole-record windows are finite and differ from the suffix's", () => {
    const whole = build({ composite: false, insufficientWindow: false }).strategyMetrics;
    expect(whole.p3m).not.toBeNull();
    expect(whole.p6m).not.toBeNull();
    expect(whole.p1y).not.toBeNull();
    // YTD begins 1 Jan: the whole record covers it, the 23 Jan suffix does not.
    expect(whole.ytd).not.toBeNull();
    expect(onSuffix.ytd).toBeNull();
  });

  it("D-12: YTD, 3M, 6M, 1Y, 3Y and 5Y are null on the 12-day suffix; MTD equals compute() over the slice", () => {
    const m = build(dated).strategyMetrics;
    for (const k of ["ytd", "p3m", "p6m", "p1y", "p3y", "p5y"] as const) {
      expect(m[k], `${k} must be null, the suffix does not cover it`).toBeNull();
    }
    // The suffix spans the month end, so MTD (the returns after 31 Jan) is covered.
    expect(onSuffix.mtd).not.toBeNull();
    expect(m.mtd).toBe(onSuffix.mtd);
  });

  it("every non-window field of strategyMetrics is the no-flag build's", () => {
    const flagged = build(dated).strategyMetrics as unknown as Record<string, unknown>;
    const control = build({ composite: false, insufficientWindow: false, twrChainBroken: true } as BuildFactsheetOpts["dataQuality"])
      .strategyMetrics as unknown as Record<string, unknown>;
    for (const k of WINDOW_KEYS) {
      delete flagged[k];
      delete control[k];
    }
    expect(flagged).toEqual(control);
  });

  it("WR-01: a Withheld row withholds the trailing windows too (all seven null), where the whole record has them", () => {
    const whole = build({ composite: false, insufficientWindow: false }).strategyMetrics;
    // Guard: the whole record has finite windows, so a null here is a decision, not an absence.
    for (const k of ["mtd", "ytd", "p3m", "p6m", "p1y"] as const) {
      expect(whole[k], `${k} is finite on the whole record`).not.toBeNull();
    }
    const withheldDq = {
      composite: false,
      insufficientWindow: false,
      twrChainBroken: true,
      headlineWithheld: true,
    } as const;
    const withheld = build(withheldDq).strategyMetrics as unknown as Record<string, unknown>;
    for (const k of WINDOW_KEYS) expect(withheld[k], `${k} must be withheld`).toBeNull();
    // Only the windows move: every other field is the no-flag build's, as on a Dated row.
    const wholeRec = { ...whole } as unknown as Record<string, unknown>;
    for (const k of WINDOW_KEYS) {
      delete withheld[k];
      delete wholeRec[k];
    }
    expect(withheld).toEqual(wholeRec);
  });

  it("WR-01: the withheld flag without twrChainBroken sets nothing (a clean row is never withheld)", () => {
    const m = build({
      composite: false,
      insufficientWindow: false,
      headlineWithheld: true,
    }).strategyMetrics;
    expect(m.p3m).not.toBeNull();
    expect(m.mtd).not.toBeNull();
  });

  it("a clean row keeps the whole-record windows", () => {
    const clean = build({ composite: false, insufficientWindow: false }).strategyMetrics;
    expect(clean.p3m).not.toBeNull();
    expect(clean.p1y).not.toBeNull();
  });

  it("the rail and compute() share ONE coverage rule: p6m is null exactly when recordCoversWindow says no", () => {
    const dates = SERIES.map((d) => d.date);
    const rets = SERIES.map((d) => d.value);
    // Whole record: covers 182 days and 365 days.
    expect(recordCoversWindow(dates, 182)).toBe(true);
    expect(recordCoversWindow(dates, 365)).toBe(true);
    expect(recordCoversWindow(dates, 3 * 365)).toBe(false);
    // The 12-day suffix covers neither 90 nor 182 days.
    const sd = suffix.map((d) => d.date);
    expect(recordCoversWindow(sd, 90)).toBe(false);
    expect(recordCoversWindow(sd, 182)).toBe(false);
    // Agreement with compute() on a window it can and cannot cover.
    const whole = compute(rets, dates, 0, 365);
    expect(whole.p6m === null).toBe(!recordCoversWindow(dates, 182));
    expect(whole.p3y === null).toBe(!recordCoversWindow(dates, 3 * 365));
    expect(onSuffix.p3m === null).toBe(!recordCoversWindow(sd, 90));
  });
});
