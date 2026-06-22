/**
 * Plan 25-04 / SHARE-02 + SHARE-03 — public recipient page contract.
 *
 * Pins, at the route layer (no real DB / network):
 *   (a) a resolving token renders the scenario NAME + persistent PROJECTED
 *       framing and leaks NO USD / allocator identity / api_keys / dashboard
 *       nav — and never calls getMyAllocationDashboard;
 *   (b) an unknown token (RPC 0 rows) → notFound();
 *   (c) resolve→revoke→404: the SAME token resolves (RPC returns a row) then,
 *       after a revoke (RPC returns 0 rows), the next render notFound()s —
 *       proving revoke immediacy at the route layer with no cached survivor
 *       (force-dynamic, SHARE-03);
 *   (d) a version-ahead RPC row → the honest-absence EmptyStateCard, never a
 *       curve / live-book substitution (DI-23-01).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import {
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
} from "@/app/(dashboard)/allocations/lib/scenario-state";

vi.mock("server-only", () => ({}));

// notFound() throws to unwind the RSC render (mirrors next/navigation).
const notFoundMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  notFound: () => {
    notFoundMock();
    throw new Error("__NOT_FOUND__");
  },
}));

// headers() — async in Next 16; returns a Headers-like object for getClientIp.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));

// Rate limiter — always allow in tests (limit-first ordering is still exercised
// because checkLimit is awaited before the admin client is touched).
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: async () => ({ success: true }),
  getClientIp: () => "203.0.113.7",
}));

// Admin client — the SOLE Supabase read. `rpcMock` drives the RPC result and
// counts calls. A guard table proves the page never reads an arbitrary table.
const rpcMock = vi.hoisted(() => vi.fn());
const adminFromMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    from: (table: string) => {
      adminFromMock(table);
      throw new Error(`page read an arbitrary table: ${table}`);
    },
  }),
}));

// getMyAllocationDashboard must NEVER be reached — count any call.
const dashboardMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => ({
  getMyAllocationDashboard: () => {
    dashboardMock();
    return Promise.resolve(null);
  },
}));

// Client components are stubbed to plain markup so renderToStaticMarkup works
// without their client-only deps. Each emits a sentinel + echoes leak-relevant
// props so we can assert what data flowed in.
vi.mock("@/app/(dashboard)/allocations/widgets/performance/EquityChart", () => ({
  EquityChart: () => <div data-testid="equity-chart">equity-chart</div>,
  // The page calls toWealth() to convert the cumulative-RETURN equity curve to
  // wealth form before feeding EquityChart — keep the real conversion.
  toWealth: (points: Array<{ date: string; value: number }>) =>
    points.map((p) => ({ ...p, __wealthBrand: true as const })),
}));
vi.mock("@/components/portfolio/CorrelationHeatmap", () => ({
  CorrelationHeatmap: ({
    strategyNames,
  }: {
    strategyNames: Record<string, string>;
  }) => (
    <div data-testid="correlation-heatmap">
      {Object.values(strategyNames).join(",")}
    </div>
  ),
}));
vi.mock(
  "@/app/(dashboard)/allocations/components/ScenarioBenchmarkSection",
  () => ({
    ScenarioBenchmarkSection: ({
      benchmarkAvailable,
    }: {
      benchmarkAvailable: boolean;
    }) => (
      <div data-testid="benchmark-section">
        benchmark:{String(benchmarkAvailable)}
      </div>
    ),
  }),
);

// --- Fixtures --------------------------------------------------------------

const STRAT_A = "11111111-1111-4111-8111-111111111111";

function makeSeries(): Array<{ date: string; value: number }> {
  const out: Array<{ date: string; value: number }> = [];
  const start = new Date("2023-01-01T00:00:00Z");
  for (let i = 0; i < 40; i += 1) {
    const d = new Date(start.getTime() + i * 86_400_000);
    out.push({ date: d.toISOString().slice(0, 10), value: 0.001 + 0.0015 * Math.sin(i / 3) });
  }
  return out;
}

function okDraft(): ScenarioDraft {
  return {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "BTC:binance:spot",
    toggleByScopeRef: { [STRAT_A]: true },
    addedStrategies: [
      { id: STRAT_A as never, name: "Momentum Alpha", markets: ["BTC"], strategy_types: ["trend"] },
    ],
    weightOverrides: { [STRAT_A]: 1 },
    lastEditedAt: "2026-06-22T00:00:00.000Z",
  };
}

function okRow() {
  return {
    name: "My Q3 Blend",
    draft: okDraft(),
    schema_version: 2,
    series: [{ strategy_id: STRAT_A, daily_returns: makeSeries() }],
  };
}

async function renderPage(token = "raw-token-abc"): Promise<string> {
  const { default: ScenarioSharePage } = await import("./page");
  const element = (await ScenarioSharePage({
    params: Promise.resolve({ token }),
  })) as ReactElement;
  return renderToStaticMarkup(element);
}

// Stub the public BTC benchmark fetch (200 [] → benchmark unavailable, which is
// fine for these assertions; resolve→404 logic does not depend on it).
beforeEach(() => {
  notFoundMock.mockClear();
  rpcMock.mockReset();
  adminFromMock.mockClear();
  dashboardMock.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => [] as unknown,
    })),
  );
});

// --- Tests -----------------------------------------------------------------

describe("ScenarioSharePage (SHARE-02 / SHARE-03)", () => {
  it("resolves a valid token → renders the scenario NAME + PROJECTED framing, NO leak", async () => {
    rpcMock.mockResolvedValueOnce({ data: [okRow()], error: null });

    const html = await renderPage();

    // RPC was the read, hashed-token arg, never an arbitrary table or dashboard.
    expect(rpcMock).toHaveBeenCalledWith("get_shared_scenario", expect.any(Object));
    expect(adminFromMock).not.toHaveBeenCalled();
    expect(dashboardMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();

    // Name + persistent PROJECTED framing rendered.
    expect(html).toContain("My Q3 Blend");
    expect(html).toContain("PROJECTED — hypothetical, not a live book");
    expect(html).toContain("Shared scenario · PROJECTED");
    expect(html).toContain("scenario-projected-badge");

    // Reused components mounted with server-resolved props.
    expect(html).toContain("equity-chart");
    expect(html).toContain("correlation-heatmap");
    expect(html).toContain("Momentum Alpha"); // de-aliased strategy name label
    expect(html).toContain("benchmark-section");

    // NO LEAK — no USD/currency, no api_keys, no holdings/AUM, no dashboard nav.
    expect(html).not.toMatch(/\$\d/); // no dollar-prefixed number
    expect(html.toLowerCase()).not.toContain("api_key");
    expect(html.toLowerCase()).not.toContain("allocated_amount");
    expect(html.toLowerCase()).not.toContain("account_balance");
    expect(html.toLowerCase()).not.toContain("value_usd");
    // No allocator identity surfaced (the fixture allocator email pattern).
    expect(html.toLowerCase()).not.toContain("@");
  });

  it("unknown token (RPC 0 rows) → notFound()", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await expect(renderPage("unknown")).rejects.toThrow("__NOT_FOUND__");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("resolve → revoke → 404: the same token 404s once the RPC returns 0 rows (SHARE-03)", async () => {
    // First load: token resolves (RPC returns a row) → 200 render.
    rpcMock.mockResolvedValueOnce({ data: [okRow()], error: null });
    const html = await renderPage("the-token");
    expect(html).toContain("My Q3 Blend");
    expect(notFoundMock).not.toHaveBeenCalled();

    // Revoke happens (Plan 25-03 sets revoked_at). The RPC now returns 0 rows.
    // force-dynamic means no cache survives → the next render must 404. This is
    // the route-layer proof of revoke immediacy.
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await expect(renderPage("the-token")).rejects.toThrow("__NOT_FOUND__");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("version-ahead RPC row → honest-absence EmptyStateCard, NEVER a curve", async () => {
    const aheadRow = {
      ...okRow(),
      draft: { ...okDraft(), schema_version: SCENARIO_SCHEMA_VERSION + 1 },
      schema_version: SCENARIO_SCHEMA_VERSION + 1,
    };
    rpcMock.mockResolvedValueOnce({ data: [aheadRow], error: null });

    const html = await renderPage("future");

    expect(notFoundMock).not.toHaveBeenCalled(); // the link IS valid → not a 404
    // renderToStaticMarkup HTML-escapes the apostrophe in "can't" → match on
    // the surrounding unambiguous substrings instead.
    expect(html).toContain("This shared scenario can");
    expect(html).toContain("be displayed");
    expect(html).toContain("saved in a newer format");
    // NEVER a rendered curve / KPI strip / live-book substitution.
    expect(html).not.toContain("equity-chart");
    expect(html).not.toContain("correlation-heatmap");
  });

  it("RPC error → notFound() (no schema leak to the recipient)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "relation \"scenario_shares\" detail" },
    });
    await expect(renderPage("err")).rejects.toThrow("__NOT_FOUND__");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
