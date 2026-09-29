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
import type { BuildFactsheetOpts } from "./build-payload";
import { fetchAndBuildPayload } from "./fetch-and-build-payload";
import type { DailyReturn, FactsheetPayload } from "./types";
import StrategyDetailPage from "@/app/(dashboard)/discovery/[slug]/[strategyId]/page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrategyDetail } from "@/lib/queries";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

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
