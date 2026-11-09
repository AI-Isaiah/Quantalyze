/** @vitest-environment jsdom */
/**
 * STALE-01 part 2 — the SEAM an anonymous tearsheet visitor actually travels.
 *
 * The tearsheet is PUBLIC: `/factsheet/[id]/tearsheet` sits in PUBLIC_ROUTES so a cap-intro
 * recipient can open the link without a login.
 *
 * ⛔ THE STRUCTURAL DEFECT THIS FILE PINS. The PDF wrapper at
 * `/api/factsheet/[id]/tearsheet.pdf` ALREADY refused a non-computed strategy
 * with a 400 "Analytics not computed" — and then `page.goto()`s THIS page to
 * screenshot it. The wrapper guarded a front door beside an open side door: the
 * HTML page is a directly reachable URL, so every figure the PDF withheld could be served
 * to anyone who typed the page URL.
 *
 * Phase 196 plan 13 moved WHERE the line is held. The page no longer prints a single figure of
 * its own: every number comes from `FactsheetView`, fed by the factsheet's payload builder,
 * and that builder refuses a row that is not a terminal success (`not_computed`), so a failed
 * or computing run gives the page a null payload and the page answers not-found. Nothing of
 * the run reaches the response, which is strictly stronger than the retired arrangement (a
 * page that rendered the strategy's name and terms around dashes).
 *
 * This is a SEAM test on purpose: real `getFactsheetDetail` (only Supabase is mocked) → real
 * `fetchAndBuildPayloadWithReason` status gate → real page. Stubbing the builder would stay green if
 * the gate were removed; stubbing the page's reads would stay green if the page grew a
 * second, ungated read. Only the seam reddens for either. `FactsheetView` is a recorder: its
 * own tests prove the opening view renders, and a mount of it is exactly what must NOT
 * happen for a non-terminal run.
 *
 * ANTI-VACUITY: the control seeds the SAME strategy as `complete` and lets the builder return
 * a payload; the page then mounts the opening view and does not 404. So the not-found above is
 * the builder's status gate speaking, not a page that always refuses.
 *
 * RETIRED with the rebuild, and why (the figures and the freshness claim now live in the
 * factsheet masthead and strip, proven by their own tests, and are never mounted for a
 * non-terminal run): T2 (monthly-returns heatmap and risk block absent), T3 (the page's own
 * FreshnessBadge makes no claim), T4 (the strategy keeps its name and terms around dashes: the
 * page now answers 404 instead), and T7 (the `complete_with_warnings` control, whose status
 * decision is the builder's `isComputedAnalytics`, pinned in the builder's own tests).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const mounted = vi.hoisted(() => ({ views: 0 }));
vi.mock("../v2/FactsheetView", () => ({
  FactsheetView: () => {
    mounted.views += 1;
    return React.createElement("div", { "data-testid": "factsheet-view" });
  },
}));

// The real builder, wrapped so the control arm can hand the page a payload.
vi.mock("@/lib/factsheet/fetch-and-build-payload", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/factsheet/fetch-and-build-payload")>();
  return { ...actual, fetchAndBuildPayloadWithReason: vi.fn(actual.fetchAndBuildPayloadWithReason) };
});

// ⛔ ManagerIdentityPanel and Disclaimer are NOT stubbed.

const seeded = vi.hoisted(() => ({ strategyRow: null as unknown }));

const buildChain = (table: string) => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  const row = () =>
    Promise.resolve(
      table === "strategies"
        ? { data: seeded.strategyRow, error: null }
        : { data: null, error: null },
    );
  chain.single = row;
  chain.maybeSingle = row;
  // `getPercentiles` awaits the builder directly; an empty cohort (< 5) returns null.
  chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(onFulfilled);
  return chain;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => buildChain(table),
    rpc: async () => ({ data: [], error: null }),
    // Anonymous — the highest-risk lane, and the one the PDF wrapper's own
    // Puppeteer fetch lands in (it carries no session cookies).
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => buildChain(table),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

import TearSheetPage from "./page";
import { fetchAndBuildPayloadWithReason } from "@/lib/factsheet/fetch-and-build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// --- Fixtures -------------------------------------------------------------

const STRATEGY_ID = "51a10001-0000-4000-8000-000000000009";

/** Best-in-class stale figures, each with a UNIQUE rendered string. */
const STALE_TEXT = {
  cagr: "+66.12%",
  sharpe: "3.77",
  sortino: "5.21",
  max_drawdown: "-3.11%",
  volatility: "+18.55%",
  calmar: "4.09",
  six_month_return: "+44.09%",
  cumulative_return: "+91.34%",
  var_1d_95: "-2.71%",
  cvar: "-3.88%",
  best_day: "+6.12%",
  worst_day: "-4.33%",
} as const;

function analytics(status: string) {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000000a",
    strategy_id: STRATEGY_ID,
    computation_status: status,
    // Re-stamped to the moment of FAILURE by the SQL status bridge — this is
    // exactly what made "Data: Fresh" appear beside dead numbers.
    computed_at: new Date().toISOString(),
    cagr: 0.6612,
    sharpe: 3.77,
    sortino: 5.21,
    calmar: 4.09,
    max_drawdown: -0.0311,
    volatility: 0.1855,
    six_month_return: 0.4409,
    cumulative_return: 0.9134,
    sparkline_returns: [1, 1.2, 1.45, 1.91],
    monthly_returns: { "2026": { Jan: 0.081, Feb: -0.014 } },
    metrics_json: {
      figure_defs_version: 2,
      var_1d_95: -0.0271,
      cvar: -0.0388,
      best_day: 0.0612,
      worst_day: -0.0433,
    },
  };
}

function seedStrategy(status: string) {
  seeded.strategyRow = {
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
    leverage_range: "1x-2x",
    benchmark: "BTC",
    discovery_categories: { slug: "crypto-sma" },
    strategy_analytics: analytics(status),
  };
}

async function renderPage() {
  const ui = await TearSheetPage({
    params: Promise.resolve({ id: STRATEGY_ID }),
  });
  render(ui as React.ReactElement);
}

beforeEach(() => {
  seeded.strategyRow = null;
  mounted.views = 0;
});

describe("STALE-01 · /factsheet/[id]/tearsheet — the PDF wrapper's side door", () => {
  it("T1: a `failed` run renders the pending state: the opening view is never mounted and no figure is rendered", async () => {
    seedStrategy("failed");
    await renderPage();

    expect(screen.getByTestId("tearsheet-pending")).toBeTruthy();
    expect(mounted.views).toBe(0);
    for (const [metric, text] of Object.entries(STALE_TEXT)) {
      expect(
        screen.queryByText(text),
        `${metric} (${text}) from a failed run leaked onto the public tearsheet`,
      ).toBeNull();
    }
  });

  it("T5: a live `computing` run is withheld the same way", async () => {
    seedStrategy("computing");
    await renderPage();
    expect(screen.getByTestId("tearsheet-pending")).toBeTruthy();
    expect(mounted.views).toBe(0);
    expect(screen.queryByText(STALE_TEXT.sharpe)).toBeNull();
    expect(screen.queryByText(STALE_TEXT.cagr)).toBeNull();
  });

  it("T6: CONTROL — the same strategy as `complete`, with a payload from the builder, mounts the opening view and does not 404", async () => {
    seedStrategy("complete");
    vi.mocked(fetchAndBuildPayloadWithReason).mockResolvedValueOnce({
      payload: {
        strategyId: STRATEGY_ID,
        aum: null,
        maxCapacity: null,
        figureRecord: null,
      } as unknown as FactsheetPayload,
      reason: null,
    });
    await renderPage();

    expect(mounted.views).toBe(1);
    expect(screen.getByTestId("factsheet-view")).toBeTruthy();
    // The strategy is intact around the opening view: its name still reaches the contact block.
    expect(screen.getAllByText(/Orpheus/).length).toBeGreaterThan(0);
  });
});
