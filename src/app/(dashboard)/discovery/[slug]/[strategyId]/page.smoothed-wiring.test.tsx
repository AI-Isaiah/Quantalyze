/** @vitest-environment jsdom */
/**
 * Phase 133 review WR-01/WR-02 — PAGE-LEVEL wiring guard for the DISCOVERY
 * render surface (`/discovery/[slug]/[strategyId]`).
 *
 * WR-01 shipped because the previous "wiring-guard" exercised the
 * `singleKeyBasisOpts` HELPER directly — so this page could drop the smoothed
 * (or MTM) series threading and every test stayed green while charts silently
 * stayed cash under an enabled Smoothed segment. This test exercises the PAGE
 * itself: it invokes the RSC with a single-key options-book row whose smoothed
 * + MTM bases are persisted, and asserts the FactsheetView element's payload
 * carries the per-basis SERIES bundles (`seriesByBasis.smoothed_mtm` /
 * `.mark_to_market`) — the exact artifacts that go missing when a call site
 * neuters the threading. Neuter check: bypass `readSingleKeyBasisOpts` (or
 * drop its spread) in the page's single-key arm → the bundle assertions
 * redden. ("Test the wiring, not just the helper.")
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
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

import StrategyDetailPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrategyDetail } from "@/lib/queries";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures ---------------------------------------------------------------

const STRATEGY_ID = "33333333-3333-4333-8333-333333333333";
const SLUG = DISCOVERY_CATEGORIES[0]!.slug;

// Post-BENCH_START (2023-04-26) cash dailies — the page's headline series.
const CASH_DAILY = [
  { date: "2025-08-01", value: 0.01 },
  { date: "2025-08-02", value: -0.02 },
  { date: "2025-08-03", value: 0.015 },
  { date: "2025-08-04", value: 0.005 },
  { date: "2025-08-05", value: -0.01 },
  { date: "2025-08-06", value: 0.02 },
  { date: "2025-08-07", value: -0.005 },
  { date: "2025-08-08", value: 0.03 },
  { date: "2025-08-09", value: -0.015 },
  { date: "2025-08-10", value: 0.01 },
];

const FULL = (cum: number) => ({
  cumulative_return: cum,
  volatility: 0.2,
  max_drawdown: -0.1,
  cagr: 0.4,
  sharpe: 1.5,
  sortino: 2.0,
  calmar: 1.1,
});

const seriesPayload = (basis: "mark_to_market" | "smoothed_mtm") => ({
  schema: 1,
  basis,
  rows: [
    { date: "2025-08-01", return: 0.011 },
    { date: "2025-08-02", return: -0.021 },
    { date: "2025-08-04", return: 0.016 },
  ],
  gap_spans: [{ start: "2025-08-03", end: "2025-08-03" }],
  conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
});

/** Admin stub serving `strategy_analytics_series` reads, dispatched on `kind`. */
function mockAdminSeries(byKind: Record<string, unknown>): {
  admin: SupabaseClient;
  readsByKind: () => string[];
} {
  const reads: string[] = [];
  const from = (table: string) => {
    let seenKind: string | undefined;
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => {
        if (col === "kind") seenKind = val;
        return chain;
      },
      maybeSingle: () => {
        if (table === "strategy_analytics_series" && seenKind) reads.push(seenKind);
        return Promise.resolve(
          table === "strategy_analytics_series" && seenKind && seenKind in byKind
            ? { data: { payload: byKind[seenKind] }, error: null }
            : { data: null, error: null },
        );
      },
    };
    return chain;
  };
  return { admin: { from } as unknown as SupabaseClient, readsByKind: () => reads };
}

function strategyRow() {
  return {
    id: STRATEGY_ID,
    name: "Phoenix Options",
    codename: null,
    disclosure_tier: "exploratory",
    strategy_types: ["options"],
    markets: ["BTC"],
    description: null,
    subtypes: [],
    supported_exchanges: ["deribit"],
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

function analyticsRow() {
  return {
    daily_returns: CASH_DAILY,
    returns_series: null,
    computed_at: "2026-07-01T00:00:00.000Z",
    data_quality_flags: {},
    metrics_json_by_basis: {
      cash_settlement: FULL(0.5),
      mark_to_market: FULL(0.4),
      smoothed_mtm: FULL(0.3),
    },
    computation_status: "complete",
  };
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

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
  } as never);
  vi.mocked(getStrategyDetail).mockResolvedValue({
    strategy: strategyRow(),
    analytics: analyticsRow(),
    disclosureTier: "exploratory",
  } as never);
});

describe("discovery page — single-key per-basis series wiring (WR-01 regression)", () => {
  it("threads the persisted smoothed AND mtm series into the FactsheetView payload", async () => {
    const { admin, readsByKind } = mockAdminSeries({
      mtm_daily_returns: seriesPayload("mark_to_market"),
      smoothed_mtm_daily_returns: seriesPayload("smoothed_mtm"),
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const jsx = await StrategyDetailPage({
      params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
    });
    const payload = findPayload(jsx);
    expect(payload, "FactsheetView payload").not.toBeNull();

    // Scalars + gates (already-shipped wiring — regression floor).
    expect(payload!.metricsByBasis?.smoothed_mtm).toBeDefined();
    expect(payload!.smoothedGate?.available).toBe(true);
    expect(payload!.mtmGate?.available).toBe(true);

    // THE WR-01 assertions: the per-basis SERIES bundles must reach the payload.
    // Before the shared readSingleKeyBasisOpts assembly, this page never read
    // the smoothed series → charts stayed cash forever under an ENABLED
    // Smoothed segment (divergent from /factsheet/[id]/v2).
    expect(
      payload!.seriesByBasis?.smoothed_mtm,
      "smoothed series bundle must reach FactsheetView on the discovery surface",
    ).toBeDefined();
    expect(
      payload!.seriesByBasis?.mark_to_market,
      "mtm series bundle must keep reaching FactsheetView on the discovery surface",
    ).toBeDefined();

    // Both persisted rows were actually read (predicate-gated roundtrips).
    expect(readsByKind()).toContain("mtm_daily_returns");
    expect(readsByKind()).toContain("smoothed_mtm_daily_returns");
  });

  it("hot non-options path: no by-basis keys → NO series roundtrips, payload stays cash-only", async () => {
    const { admin, readsByKind } = mockAdminSeries({});
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    vi.mocked(getStrategyDetail).mockResolvedValue({
      strategy: strategyRow(),
      analytics: { ...analyticsRow(), metrics_json_by_basis: null },
      disclosureTier: "exploratory",
    } as never);

    const jsx = await StrategyDetailPage({
      params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
    });
    const payload = findPayload(jsx);
    expect(payload).not.toBeNull();
    expect(payload!.seriesByBasis).toBeUndefined();
    expect(payload!.mtmGate).toBeUndefined();
    expect(payload!.smoothedGate).toBeUndefined();
    expect(readsByKind()).toEqual([]);
  });
});
