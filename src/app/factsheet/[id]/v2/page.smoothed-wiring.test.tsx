/** @vitest-environment jsdom */
/**
 * Phase 133 review WR-02 — PAGE-LEVEL wiring guard for the canonical factsheet
 * render surface (`/factsheet/[id]/v2`), the sibling of
 * `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.smoothed-wiring.test.tsx`.
 *
 * The pre-review "wiring-guard" exercised `singleKeyBasisOpts` DIRECTLY, so a
 * page could drop the series threading (exactly how WR-01 shipped on the
 * discovery surface) and the whole suite stayed green. This test invokes the
 * RSC itself — through the real `fetchAndBuildPayload` (unstable_cache stubbed
 * to identity) — with a single-key options-book row whose smoothed + MTM bases
 * are persisted, and asserts the FactsheetView element's payload carries the
 * per-basis SERIES bundles. Neuter check: drop the `readSingleKeyBasisOpts`
 * spread (or regress it to the old 4-arg inline copy) in this page's
 * single-key arm → the `seriesByBasis.smoothed_mtm` assertion reddens.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
// unstable_cache → identity: the test exercises the REAL fetchAndBuildPayload,
// not Next's cache plumbing (cache keys/tags are out of scope here).
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
// withPublishedOnly → passthrough builder: the published-only visibility gate
// is SQL-side and owned by its own tests; here every fixture row is published.
vi.mock("@/lib/visibility", () => ({
  withPublishedOnly: (qb: unknown) => qb,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: vi.fn(),
}));

import FactsheetV2Page from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPublicVerificationSignals } from "@/lib/queries";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures ---------------------------------------------------------------

const STRATEGY_ID = "44444444-4444-4444-8444-444444444444";

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

function strategyRow(metricsJsonByBasis: unknown) {
  return {
    id: STRATEGY_ID,
    name: "Phoenix Options",
    codename: null,
    disclosure_tier: "exploratory",
    status: "published",
    markets: ["BTC"],
    strategy_types: ["options"],
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
    returns_denominator_config: null,
    strategy_analytics: {
      daily_returns: CASH_DAILY,
      returns_series: null,
      computed_at: "2026-07-01T00:00:00.000Z",
      data_quality_flags: {},
      metrics_json_by_basis: metricsJsonByBasis,
      computation_status: "complete",
    },
  };
}

/**
 * Admin stub: serves the fetchAndBuildPayload `strategies` probe AND the
 * per-basis `strategy_analytics_series` reads (dispatched on `kind`).
 */
function mockAdmin(
  strategy: unknown,
  byKind: Record<string, unknown>,
): { admin: SupabaseClient; readsByKind: () => string[] } {
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
        if (table === "strategies") {
          return Promise.resolve({ data: strategy, error: null });
        }
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

/** Request-client stub for the outer signature probe. */
function mockRequestClient() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: STRATEGY_ID,
          name: "Phoenix Options",
          codename: null,
          disclosure_tier: "exploratory",
          strategy_analytics: { computed_at: "2026-07-01T00:00:00.000Z" },
        },
        error: null,
      }),
  };
  return { from: () => chain };
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
  vi.mocked(createClient).mockResolvedValue(mockRequestClient() as never);
  vi.mocked(readPublicVerificationSignals).mockResolvedValue(
    new Map([[STRATEGY_ID, { trust_tier: "api_verified", status: "verified" }]]) as never,
  );
});

describe("factsheet v2 page — single-key per-basis series wiring (WR-02 guard)", () => {
  it("threads the persisted smoothed AND mtm series into the FactsheetView payload", async () => {
    const { admin, readsByKind } = mockAdmin(
      strategyRow({
        cash_settlement: FULL(0.5),
        mark_to_market: FULL(0.4),
        smoothed_mtm: FULL(0.3),
      }),
      {
        mtm_daily_returns: seriesPayload("mark_to_market"),
        smoothed_mtm_daily_returns: seriesPayload("smoothed_mtm"),
      },
    );
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const jsx = await FactsheetV2Page({
      params: Promise.resolve({ id: STRATEGY_ID }),
    });
    const payload = findPayload(jsx);
    expect(payload, "FactsheetView payload").not.toBeNull();

    // Scalars + gates (regression floor).
    expect(payload!.metricsByBasis?.smoothed_mtm).toBeDefined();
    expect(payload!.smoothedGate?.available).toBe(true);
    expect(payload!.mtmGate?.available).toBe(true);

    // THE call-site wiring assertions: neuter this page's readSingleKeyBasisOpts
    // spread (the WR-01 failure mode, on THIS surface) → these redden.
    expect(
      payload!.seriesByBasis?.smoothed_mtm,
      "smoothed series bundle must reach FactsheetView on /factsheet/[id]/v2",
    ).toBeDefined();
    expect(
      payload!.seriesByBasis?.mark_to_market,
      "mtm series bundle must keep reaching FactsheetView on /factsheet/[id]/v2",
    ).toBeDefined();

    expect(readsByKind()).toContain("mtm_daily_returns");
    expect(readsByKind()).toContain("smoothed_mtm_daily_returns");
  });

  it("hot non-options path: no by-basis keys → NO series roundtrips, payload stays cash-only", async () => {
    const { admin, readsByKind } = mockAdmin(strategyRow(null), {});
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const jsx = await FactsheetV2Page({
      params: Promise.resolve({ id: STRATEGY_ID }),
    });
    const payload = findPayload(jsx);
    expect(payload).not.toBeNull();
    expect(payload!.seriesByBasis).toBeUndefined();
    expect(payload!.mtmGate).toBeUndefined();
    expect(payload!.smoothedGate).toBeUndefined();
    expect(readsByKind()).toEqual([]);
  });
});
