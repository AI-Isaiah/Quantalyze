/** @vitest-environment jsdom */
/**
 * STALE-01 part 2 — the SEAM an anonymous tearsheet visitor actually travels.
 *
 * The tearsheet is the widest single-strategy metric surface in the product —
 * hero grid, detail grid, the `metrics_json` VaR/CVaR/best-day/worst-day block
 * and the monthly-returns heatmap — and it is PUBLIC: `/factsheet/[id]/
 * tearsheet` sits in PUBLIC_ROUTES so a cap-intro recipient can open the link
 * without a login.
 *
 * ⛔ THE STRUCTURAL DEFECT THIS FILE PINS. The PDF wrapper at
 * `/api/factsheet/[id]/tearsheet.pdf` ALREADY refused a non-computed strategy
 * with a 400 "Analytics not computed" — and then `page.goto()`s THIS page to
 * screenshot it. The wrapper guarded a front door beside an open side door: the
 * HTML page is a directly reachable URL and had no status gate at all, so every
 * figure the PDF withheld was served in full to anyone who typed the page URL.
 * The wrapper is deliberately UNCHANGED by this fix; the page now holds the
 * same line, which is what makes the wrapper's refusal mean anything.
 *
 * This is a SEAM test on purpose: real `getFactsheetDetail` (only Supabase is
 * mocked) → real shaper → real page. Unit-testing the shaper alone would stay
 * green if the page grew a second, ungated read; unit-testing the page against
 * a mocked query would stay green if the shaper were removed. Only the seam
 * reddens for either.
 *
 * TWO INDEPENDENT SUPPRESSORS, DELIBERATELY BOTH PINNED (and each witnessed RED
 * on its own, not merely together):
 *   - the VALUES are withheld by `shapeRowAnalytics` inside getFactsheetDetail.
 *   - the FRESHNESS BADGE is withheld by this page. That one CANNOT ride on the
 *     shaper: `FreshnessBadge` does not early-return on a blank `computed_at`,
 *     it routes it through `computeFreshness` (unparseable → "stale") and
 *     renders a confident "Data: Stale" pill standing over a grid of em-dashes.
 *
 * ANTI-VACUITY: `FreshnessBadge` is deliberately NOT stubbed here (the sibling
 * spec in this directory stubs it, which is why it could not have caught this).
 * Fixtures carry real, distinctive, best-in-class stale values, and a
 * terminal-success control renders the identical assertions inverted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/charts/Sparkline", () => ({
  Sparkline: () => React.createElement("div", { "data-testid": "sparkline" }),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// ⛔ FreshnessBadge, ManagerIdentityPanel and Disclaimer are NOT stubbed — the
// badge IS one of the claims under test.

const seeded = vi.hoisted(() => ({ strategyRow: null as unknown }));

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
  // `getPercentiles` awaits the builder directly; an empty cohort (< 5) returns
  // null, so the peer-rank section stays out of this spec.
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
});

describe("STALE-01 · /factsheet/[id]/tearsheet — the PDF wrapper's side door", () => {
  it("T1: not one figure from a `failed` run reaches the rendered tearsheet", async () => {
    seedStrategy("failed");
    await renderPage();

    for (const [metric, text] of Object.entries(STALE_TEXT)) {
      expect(
        screen.queryByText(text),
        `${metric} (${text}) from a failed run leaked onto the public tearsheet`,
      ).toBeNull();
    }
  });

  it("T2: the monthly-returns heatmap and the risk block disappear with them", async () => {
    seedStrategy("failed");
    await renderPage();

    // The heatmap section renders only when `monthly_returns` is truthy.
    expect(screen.queryByText("Monthly Returns")).toBeNull();
    expect(screen.queryByText("+8.10%")).toBeNull();
    // The equity-curve section renders only on a non-empty sparkline.
    expect(screen.queryByTestId("sparkline")).toBeNull();
    expect(screen.queryByText("Equity Curve")).toBeNull();
  });

  it("T3: the freshness badge makes NO claim — a failed run has no moment to name", async () => {
    seedStrategy("failed");
    await renderPage();

    // The badge's three possible labels. `computed_at` is blanked by the
    // shaper, but FreshnessBadge maps an unparseable timestamp to "Stale" and
    // renders anyway — so this assertion can ONLY pass because the page
    // withholds the badge.
    expect(screen.queryByText("Fresh")).toBeNull();
    expect(screen.queryByText("Warm")).toBeNull();
    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.queryByText("Data:")).toBeNull();
  });

  it("T4: the strategy is not deleted — it keeps its name and its allocation terms", async () => {
    seedStrategy("failed");
    await renderPage();

    // The codename appears in the H1, the redacted manager panel and the CTA.
    expect(screen.getAllByText("Orpheus").length).toBeGreaterThan(0);
    expect(screen.getByText("Allocation Terms")).toBeTruthy();
    // `aum`, `leverage_range` and `benchmark` live on the strategies row and
    // are NOT products of the analytics job.
    expect(screen.getByText("1x-2x")).toBeTruthy();
  });

  it("T5: a live `computing` run is withheld the same way", async () => {
    seedStrategy("computing");
    await renderPage();

    expect(screen.queryByText(STALE_TEXT.sharpe)).toBeNull();
    expect(screen.queryByText(STALE_TEXT.cagr)).toBeNull();
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("T6: CONTROL — a `complete` run renders every figure, the heatmap and the badge", async () => {
    seedStrategy("complete");
    await renderPage();

    for (const [metric, text] of Object.entries(STALE_TEXT)) {
      expect(
        screen.queryByText(text),
        `${metric} (${text}) vanished from a COMPLETE strategy — the gate is over-broad`,
      ).not.toBeNull();
    }
    expect(screen.getByText("Monthly Returns")).toBeTruthy();
    expect(screen.getByTestId("sparkline")).toBeTruthy();
    // `computed_at` is "now" on the control, so the badge reads Fresh.
    expect(screen.getByText("Fresh")).toBeTruthy();
  });

  it("T7: CONTROL — `complete_with_warnings` is a terminal SUCCESS and keeps everything", async () => {
    seedStrategy("complete_with_warnings");
    await renderPage();

    expect(screen.queryByText(STALE_TEXT.sharpe)).not.toBeNull();
    expect(screen.getByText("Fresh")).toBeTruthy();
  });
});
