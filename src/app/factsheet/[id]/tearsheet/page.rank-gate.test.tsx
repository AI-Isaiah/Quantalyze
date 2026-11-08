/**
 * Phase 194 plan 18 (D-11 as superseded by D-15, founder-decided 2026-11-07): the tearsheet's
 * peer-rank badges for the ANNUALISED metrics (CAGR, Sharpe, Sortino, Volatility) carry the
 * `<1y` marker when the strategy's total record cleared D-15's minimum but spans under one
 * year. Max DD is not annualised and never carries it. A record of a year or more carries no
 * marker. The real `PercentileRankBadge` is rendered (page.test.tsx stubs it), so what is
 * asserted is what a reader sees.
 *
 * Mocks follow `page.test.tsx` (not edited here: Phase 195 also edits that file).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/charts/Sparkline", () => ({
  Sparkline: () => React.createElement("div", { "data-testid": "sparkline" }),
}));
vi.mock("@/components/strategy/FreshnessBadge", () => ({
  FreshnessBadge: () => React.createElement("span"),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));

vi.mock("@/lib/queries", () => ({
  getFactsheetDetail: vi.fn().mockResolvedValue({
    strategy: {
      id: "s-1",
      name: "Test Strategy",
      codename: "STRAT-001",
      status: "published",
      disclosure_tier: "institutional",
      user_id: "u-1",
      strategy_types: ["Momentum"],
      markets: ["BTC"],
      start_date: "2024-01-01",
      leverage_range: "1x-2x",
      benchmark: "BTC",
      aum: 100_000,
      discovery_categories: { slug: "momentum" },
    },
    analytics: {
      cagr: 0.25,
      sharpe: 1.5,
      sortino: 2.0,
      max_drawdown: -0.1,
      volatility: 0.2,
      calmar: 2.5,
      six_month_return: 0.1,
      cumulative_return: 0.3,
      computed_at: "2024-06-01T00:00:00Z",
      computation_status: "complete",
      sparkline_returns: [0.01, 0.02, -0.01, 0.03],
      monthly_returns: { "2024": { Jan: 0.05, Feb: 0.03 } },
      metrics_json: { figure_defs_version: 2, var_1d_95: -0.02, cvar: -0.03 },
    },
    manager: {
      display_name: "Jane Doe",
      company: "Doe Capital",
      bio: "Bio",
      years_trading: 12,
      aum_range: "$10M-$50M",
      linkedin: "https://linkedin.com/in/jane-doe-test",
    },
    disclosureTier: "institutional",
  }),
  // The rank map the badges read. Five metrics are shown on the tearsheet.
  getPercentiles: vi.fn().mockResolvedValue({
    "s-1": { cagr: 70, sharpe: 80, sortino: 75, max_drawdown: 60, volatility: 55 },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => ({
    data: { api_keys: null, strategy_analytics: { trades_fetched_at: null, series_provenance: null } },
    error: null,
  });
  return { createAdminClient: () => ({ from: () => builder }) };
});

import TearSheetPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { getUserRolesResult } from "@/lib/auth";
import { shortTrackMarkerTitle } from "@/lib/figure-gate";

afterEach(cleanup);

/**
 * An anonymous viewer, a USD strategy, and the record the span read returns. The strategy has
 * no `asset_class`, so it is judged as non-crypto: it clears D-15 on its observation count.
 */
function stub(span: {
  start: string;
  end: string;
  observations: number;
}) {
  vi.mocked(getUserRolesResult).mockResolvedValue({ ok: true, roles: [] } as never);
  const from = vi.fn((table: string) => {
    if (table === "investor_attestations") {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      return { select: vi.fn().mockReturnValue({ eq }) };
    }
    let isSpan = false;
    const builder = {
      select: (cols: string) => {
        isSpan = cols.includes("record_observations");
        return builder;
      },
      eq: () => builder,
      maybeSingle: async () =>
        isSpan
          ? {
              data: {
                strategy_analytics: {
                  series_start: span.start,
                  series_end: span.end,
                  headline_since: null,
                  record_observations: span.observations,
                },
              },
              error: null,
            }
          : { data: { strategy_analytics: { data_quality_flags: {} } }, error: null },
    };
    return builder;
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

async function renderPage() {
  const page = await TearSheetPage({ params: Promise.resolve({ id: "s-1" }) });
  return render(page as React.ReactElement);
}

/** The badge whose label is `label`, from the "Peer-relative ranks" section. */
function badge(label: string): HTMLElement {
  const section = screen.getByText("Peer-relative ranks").closest("section") as HTMLElement;
  const hit = within(section)
    .getAllByTestId("percentile-rank-badge")
    .find((el) => el.firstElementChild?.textContent === label);
  if (!hit) throw new Error(`no ${label} badge`);
  return hit;
}

describe("TearSheet page - rank badges carry the short-track marker (D-15)", () => {
  it("a 200-day record: CAGR, Sharpe, Sortino and Volatility badges carry <1y; Max DD does not", async () => {
    // 2025-09-01 -> 2026-03-19 covers 200 days (D-20 counts both ends); 140 observations clears the 60 minimum.
    stub({ start: "2025-09-01", end: "2026-03-19", observations: 140 });
    await renderPage();

    const reason = shortTrackMarkerTitle(200);
    for (const label of ["CAGR", "Sharpe", "Sortino", "Volatility"]) {
      const b = badge(label);
      expect(b, label).toHaveTextContent("<1y");
      expect(within(b).getByTitle(reason), label).toBeInTheDocument();
    }
    const dd = badge("Max DD");
    expect(dd).not.toHaveTextContent("<1y");
    expect(dd.querySelector(".sr-only")).toBeNull();
  });

  it("a 400-day record: no badge carries the marker", async () => {
    // 2025-01-01 -> 2026-02-05 is 400 calendar days.
    stub({ start: "2025-01-01", end: "2026-02-05", observations: 280 });
    await renderPage();

    const section = screen.getByText("Peer-relative ranks").closest("section") as HTMLElement;
    const badges = within(section).getAllByTestId("percentile-rank-badge");
    expect(badges).toHaveLength(5);
    for (const b of badges) expect(b).not.toHaveTextContent("<1y");
  });
});

describe("TearSheet page - a withheld or unreadable record ranks Max DD only (194 review WR-01, D-18)", () => {
  const labels = (): string[] => {
    const section = screen.getByText("Peer-relative ranks").closest("section") as HTMLElement;
    return within(section)
      .getAllByTestId("percentile-rank-badge")
      .map((el) => el.firstElementChild?.textContent ?? "");
  };

  it("a 20-observation record (under D-15's minimum): only the Max DD rank renders, though getPercentiles returned all five", async () => {
    stub({ start: "2026-03-01", end: "2026-03-20", observations: 20 });
    await renderPage();
    expect(labels()).toEqual(["Max DD"]);
  });

  it("a span read that fails: the figures dash, so the annualised ranks do not render either; Max DD keeps its rank", async () => {
    stub({ start: "2025-01-01", end: "2026-02-05", observations: 280 });
    // No request client: the span read cannot be made and the gate fails closed.
    vi.mocked(createClient).mockResolvedValue(null as never);
    await renderPage();
    expect(labels()).toEqual(["Max DD"]);
  });
});

