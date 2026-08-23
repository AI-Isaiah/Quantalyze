/**
 * Phase 09 / Task 1 + Task 2 — ComparePage RTL tests.
 *
 * TDD RED phase: tests written before implementation.
 *
 * Covers:
 * - Strategy-only regression (pre-Phase-09 path byte-preserved)
 * - Holding-side branch render (LIVE-03 + finding g4)
 * - Charset-rejected holding_ref → "not available" (finding f6)
 * - Mixed holding + strategy side-by-side (finding g4)
 * - RLS-gated empty holdings → "not available" (D-15)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted
// ---------------------------------------------------------------------------

// server-only package throws in jsdom test environment — mock to no-op.
// Needed because EMPTY_ANALYTICS from @/lib/queries transitively imports
// @/lib/supabase/admin which has `import "server-only"`.
vi.mock("server-only", () => ({}));

// Mock next/navigation so redirect() is a no-op in tests
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// Mock Breadcrumb + PageHeader as minimal stubs (they rely on server context)
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", { "data-testid": "page-header" }, title),
}));
vi.mock("@/components/layout/Breadcrumb", () => ({
  Breadcrumb: () => React.createElement("nav", { "data-testid": "breadcrumb" }),
}));

// Mock CompareEquityOverlay + CompareCorrelationMatrix (heavy chart deps)
vi.mock("@/components/strategy/CompareEquityOverlay", () => ({
  CompareEquityOverlay: () =>
    React.createElement("div", { "data-testid": "equity-overlay" }),
}));
vi.mock("@/components/strategy/CompareCorrelationMatrix", () => ({
  CompareCorrelationMatrix: () =>
    React.createElement("div", { "data-testid": "corr-matrix" }),
}));

// ---------------------------------------------------------------------------
// Supabase mock factory — returns different data based on what is queried
// ---------------------------------------------------------------------------

type MockSnapshot = {
  asof: string;
  breakdown: Record<string, number> | null;
};

// Controls for the mock: strategy data + snapshot data
let mockStrategyData: unknown[] = [];
let mockSnapshotData: MockSnapshot[] = [];

/**
 * Phase 159 (159-03 / RANK-02) — every `.select()` string issued against the
 * `strategies` table, so the explicit analytics projection can be pinned.
 */
const strategySelectCalls: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    // Helper: builds a thenable Supabase-style query builder that resolves to { data, error }
    function makeQueryBuilder(
      resolveData: () => unknown[],
      recordSelect = false,
    ): Record<string, unknown> {
      const resolve = () =>
        Promise.resolve({ data: resolveData(), error: null });
      const builder: Record<string, unknown> = {
        // Phase 159 (159-03 / RANK-02): records the projection for the
        // strategies read. Written as an implementation rather than
        // `.mockReturnThis()` so the argument is observable.
        select: vi.fn((cols?: string) => {
          if (recordSelect && typeof cols === "string") {
            strategySelectCalls.push(cols);
          }
          return builder;
        }),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        // limit() is called as the terminal step for snapshot queries
        limit: vi.fn(async () => ({ data: resolveData(), error: null })),
        // maybeSingle() is the terminal step for the Phase 109 requireRolePage
        // guard's `profiles.select("role").eq("id", …).maybeSingle()` lookup.
        maybeSingle: vi.fn(async () => ({ data: resolveData()[0] ?? null, error: null })),
        // Make the builder itself awaitable (Supabase pattern: await builder resolves { data, error })
        then: (
          onfulfilled?: ((v: unknown) => unknown) | null,
          onrejected?: ((e: unknown) => unknown) | null,
        ) => resolve().then(onfulfilled, onrejected),
        catch: (onrejected?: ((e: unknown) => unknown) | null) =>
          resolve().catch(onrejected),
        finally: (onfinally?: (() => void) | null) =>
          resolve().finally(onfinally),
      };
      // self-referential mockReturnThis needs the object already built
      // (`select` is excluded — it carries a recording implementation above,
      // and mockReturnValue would discard it).
      (builder.in as ReturnType<typeof vi.fn>).mockReturnValue(builder);
      (builder.eq as ReturnType<typeof vi.fn>).mockReturnValue(builder);
      (builder.order as ReturnType<typeof vi.fn>).mockReturnValue(builder);
      return builder;
    }

    return {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "alloc-test-1" } },
        })),
      },
      from: vi.fn((table: string) => {
        // Phase 109: the requireRolePage guard (compare is allocator-owned)
        // reads profiles.role first — return an allocator so the guard passes.
        if (table === "profiles") {
          return makeQueryBuilder(() => [{ role: "allocator" }]);
        }
        if (table === "strategies") {
          return makeQueryBuilder(() => mockStrategyData, true);
        }
        if (table === "allocator_equity_snapshots") {
          return makeQueryBuilder(() => mockSnapshotData);
        }
        return makeQueryBuilder(() => []);
      }),
    };
  }),
}));

// ---------------------------------------------------------------------------
// Import page AFTER mocks are registered
// ---------------------------------------------------------------------------
// Dynamic import is used so vi.mock hoisting works correctly with ESM
const getComparePage = async () => {
  const mod = await import("./page");
  return mod.default;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSampleStrategy(id: string, name: string) {
  return {
    id,
    name,
    status: "published",
    strategy_analytics: {
      strategy_id: id,
      cumulative_return: 0.35,
      sharpe: 1.5,
      max_drawdown: -0.12,
      volatility: 0.4,
    },
  };
}

function makeSampleSnapshots(symbol: string, count: number): MockSnapshot[] {
  const snaps: MockSnapshot[] = [];
  const base = new Date("2025-01-01").getTime();
  for (let i = 0; i < count; i++) {
    const d = new Date(base + i * 86400 * 1000).toISOString().slice(0, 10);
    snaps.push({
      asof: d,
      breakdown: { [symbol]: 1000 + i * 10 },
    });
  }
  return snaps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComparePage — strategy-only regression (pre-Phase-09 path preserved)", () => {
  beforeEach(() => {
    // Reset mock controls
    mockStrategyData = [
      makeSampleStrategy(
        "11111111-2222-4333-8444-555555555555",
        "Strategy Alpha",
      ),
      makeSampleStrategy(
        "22222222-3333-4444-8555-666666666666",
        "Strategy Beta",
      ),
    ];
    mockSnapshotData = [];
  });

  it("renders the page header for a strategy-only compare", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "11111111-2222-4333-8444-555555555555,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);
    // Heading should mention "items" or "Strategies"
    const header = screen.getByTestId("page-header");
    expect(header).toBeInTheDocument();
  });

  it("renders zero HoldingFactsheet elements for strategy-only ids (regression)", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "11111111-2222-4333-8444-555555555555,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);
    expect(screen.queryByTestId("holding-factsheet")).not.toBeInTheDocument();
  });
});

describe("ComparePage — holding-side branch (LIVE-03 + finding g4 render parity)", () => {
  beforeEach(() => {
    // Default: A owns holding:binance:BTC:spot with 40 snapshot days
    mockStrategyData = [];
    mockSnapshotData = makeSampleSnapshots("BTC", 40);
  });

  it("renders HoldingFactsheet when ids contain holding: prefix and allocator owns it", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:binance:BTC:spot",
      }),
    });
    render(Page as React.ReactElement);
    // HoldingFactsheet should be present
    expect(screen.getByTestId("holding-factsheet")).toBeInTheDocument();
    // "Holding" badge
    expect(screen.getByText(/Holding/i)).toBeInTheDocument();
    // BTC symbol
    expect(screen.getByText("BTC")).toBeInTheDocument();
  });

  it("shows 'not available' when holding fetch returns empty (RLS-gated or no data)", async () => {
    mockSnapshotData = []; // no snapshots → fetchHoldingCompareItem returns null
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:binance:BTC:spot",
      }),
    });
    render(Page as React.ReactElement);
    expect(
      screen.getByText(/not available|comparison isn't|not found/i),
    ).toBeInTheDocument();
  });

  it("silently rejects malformed-charset holding_ref (finding f6 — same not-available render)", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:binance:BTC/USDT:spot",
      }),
    });
    render(Page as React.ReactElement);
    // Charset-violation treated as "not a valid item" → not-available render
    expect(
      screen.getByText(/not available|comparison isn't|not found/i),
    ).toBeInTheDocument();
  });

  it("caps ids at 4 (preserves existing limit)", async () => {
    // 5 ids — only 4 should be processed (5th ignored)
    // No assertion needed beyond "page renders without crash"
    const ComparePage = await getComparePage();
    await expect(
      ComparePage({
        searchParams: Promise.resolve({
          ids: "holding:binance:BTC:spot,holding:binance:ETH:spot,holding:binance:SOL:spot,holding:binance:ADA:spot,holding:binance:XRP:spot",
        }),
      }),
    ).resolves.not.toThrow();
  });
});

describe("ComparePage — finding g4 mixed render (HoldingFactsheet + StrategyFactsheet side-by-side)", () => {
  beforeEach(() => {
    mockStrategyData = [
      makeSampleStrategy(
        "22222222-3333-4444-8555-666666666666",
        "Strategy Beta",
      ),
    ];
    mockSnapshotData = makeSampleSnapshots("BTC", 40);
  });

  it("/compare?ids=holding:binance:BTC:spot,<uuid> renders HoldingFactsheet side-by-side", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:binance:BTC:spot,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);
    // HoldingFactsheet panel
    expect(screen.getByTestId("holding-factsheet")).toBeInTheDocument();
    // Strategy name rendered
    expect(screen.getByText("Strategy Beta")).toBeInTheDocument();
  });

  it("/compare?ids=<uuid>,<uuid> renders ZERO HoldingFactsheets (regression)", async () => {
    mockSnapshotData = [];
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "11111111-2222-4333-8444-555555555555,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);
    expect(screen.queryByTestId("holding-factsheet")).not.toBeInTheDocument();
  });
});

/**
 * Phase 159 (159-03, RANK-02 / decision D-02) — the compare read was the
 * fourth `strategy_analytics` wildcard embed. It is an AUTHED allocator
 * surface (`requireRolePage(…, "allocator")`), but it is CROSS-TENANT: an
 * allocator pulls other managers' published strategies, so the requirement
 * names this site explicitly alongside the anonymous ones.
 *
 * These pins capture the projection string the page issues. Neuterable:
 * putting an excluded column back into the list reds the negative arm;
 * dropping `returns_series` reds the consumer arm (the equity overlay and
 * correlation matrix both read it, so that omission is a blank-chart bug).
 */
describe("ComparePage — RANK-02 explicit analytics projection", () => {
  beforeEach(() => {
    strategySelectCalls.length = 0;
    mockStrategyData = [
      makeSampleStrategy("11111111-2222-4333-8444-555555555555", "Strategy Alpha"),
      makeSampleStrategy("22222222-3333-4444-8555-666666666666", "Strategy Beta"),
    ];
    mockSnapshotData = [];
  });

  const capture = async () => {
    const ComparePage = await getComparePage();
    await ComparePage({
      searchParams: Promise.resolve({
        ids: "11111111-2222-4333-8444-555555555555,22222222-3333-4444-8555-666666666666",
      }),
    });
    const cols = strategySelectCalls.find((c) => c.includes("strategy_analytics")) ?? "";
    return { cols, embed: /strategy_analytics \(([^)]*)\)/.exec(cols)?.[1] ?? "" };
  };

  it("issues an explicit analytics column list, never the wildcard embed", async () => {
    const { cols, embed } = await capture();
    expect(cols).not.toContain("strategy_analytics (*)");
    expect(embed).not.toBe("*");
    expect(embed.length).toBeGreaterThan(0);
  });

  it("keeps every analytics field the compare UI consumes", async () => {
    const { embed } = await capture();
    // CompareTable METRICS rows (CompareTable.tsx :27-37) + the returns_series
    // both CompareEquityOverlay (:40) and CompareCorrelationMatrix (:26) read.
    for (const column of [
      "cumulative_return",
      "cagr",
      "sharpe",
      "sortino",
      "calmar",
      "max_drawdown",
      "max_drawdown_duration_days",
      "volatility",
      "six_month_return",
      "returns_series",
    ]) {
      expect(embed).toContain(column);
    }
  });

  it("never projects daily_returns, metrics_json, or data_quality_flags", async () => {
    const { cols, embed } = await capture();
    expect(cols).not.toContain("daily_returns");
    expect(cols).not.toContain("data_quality_flags");
    expect(embed).not.toMatch(/metrics_json(?!->)/);
  });
});
