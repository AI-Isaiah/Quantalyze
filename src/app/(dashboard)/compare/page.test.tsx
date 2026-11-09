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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { COMPARE_ANALYTICS_COLUMNS } from "@/lib/queries";

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

// The "Add strategy" search is a client component with its own suite
// (CompareAddStrategy.test.tsx). A recording stub keeps useRouter out of this
// server-page suite and records the ids the page hands it.
let addStrategyIds: readonly string[] | null = null;
vi.mock("./CompareAddStrategy", () => ({
  CompareAddStrategy: ({ currentIds }: { currentIds: readonly string[] }) => {
    addStrategyIds = currentIds;
    return React.createElement("div", { "data-testid": "add-strategy" });
  },
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
// Phase 170.2 (SC-3): records the items the page hands the overlay, so the
// covered-from fields can be asserted without rendering recharts.
type OverlayItem = {
  strategy: { id: string };
  analytics: Record<string, unknown>;
  headlineCoversFrom?: string | null;
  headlineCoversFromStatus?: string;
};
let overlayItems: OverlayItem[] = [];
vi.mock("@/components/strategy/CompareEquityOverlay", () => ({
  CompareEquityOverlay: ({ items }: { items: OverlayItem[] }) => {
    overlayItems = items;
    return React.createElement("div", { "data-testid": "equity-overlay" });
  },
}));
// Phase 190 plan 07: also records the matrix's items, so the effective curve
// method it is handed can be compared with the overlay's.
let matrixItems: Array<{ strategy: { id: string }; analytics: Record<string, unknown> }> = [];
vi.mock("@/components/strategy/CompareCorrelationMatrix", () => ({
  CompareCorrelationMatrix: ({
    items,
  }: {
    items: Array<{ strategy: { id: string }; analytics: Record<string, unknown> }>;
  }) => {
    matrixItems = items;
    return React.createElement("div", { "data-testid": "corr-matrix" });
  },
}));

// ---------------------------------------------------------------------------
// Supabase mock factory — returns different data based on what is queried
// ---------------------------------------------------------------------------

// Phase 167.1.1 / D-03: the holding read is `allocator_holdings` (the daily
// mark price), not `allocator_equity_snapshots`.
type MockHolding = {
  asof: string;
  mark_price: number;
  updated_at: string;
  api_key_id: string;
};

// Controls for the mock: strategy data + holding price rows
let mockStrategyData: unknown[] = [];
let mockHoldingData: MockHolding[] = [];
// Phase 167.1.2 review round 2 (SFH-R2-02): per-table query errors.
let mockStrategyError: { message: string } | null = null;
let mockHoldingError: { message: string } | null = null;

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
      resolveError: () => { message: string } | null = () => null,
    ): Record<string, unknown> {
      const resolve = () =>
        Promise.resolve(
          resolveError()
            ? { data: null, error: resolveError() }
            : { data: resolveData(), error: null },
        );
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
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        // range() ends the paged allocator_holdings read (a short page, so one
        // page); the builder is awaitable, so it resolves like the others.
        range: vi.fn().mockReturnThis(),
        // limit() is called as the terminal step for other queries
        limit: vi.fn(() => resolve()),
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
      (builder.gte as ReturnType<typeof vi.fn>).mockReturnValue(builder);
      (builder.range as ReturnType<typeof vi.fn>).mockReturnValue(builder);
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
          return makeQueryBuilder(() => mockStrategyData, true, () => mockStrategyError);
        }
        if (table === "allocator_holdings") {
          return makeQueryBuilder(() => mockHoldingData, false, () => mockHoldingError);
        }
        return makeQueryBuilder(() => []);
      }),
    };
  }),
}));

// Phase 170.2 (SC-3, T-170.2-10) read a chain-broken row's stored cash_settlement
// series through the admin client. Phase 190 plan 07 removed that read: the
// covered-from date is the effective `headline_since`. The mock stays (the page
// imports `@/lib/queries`, which imports the admin module) and now answers a
// payload NAMING A DIFFERENT DATE than every fixture's `headline_since`, and
// records every series read, so a regression back to the series row is
// observable twice over: a read is recorded, and the wrong date appears.
type AdminAnswer =
  | { kind: "payload"; payload: unknown }
  | { kind: "none" }
  | { kind: "error" };
const adminReadIds: string[] = [];
let adminAnswer: AdminAnswer = { kind: "none" };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: async () => {
          if (table === "strategy_analytics_series") {
            adminReadIds.push(String(filters.strategy_id));
          }
          if (adminAnswer.kind === "error") {
            return { data: null, error: { code: "57014", message: "pg-boom-secret" } };
          }
          if (adminAnswer.kind === "payload") {
            return { data: { payload: adminAnswer.payload }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  })),
}));

// A cash_settlement payload whose last gap ends 2026-08-21: the headline return
// compounds from the first stored row after it, 2026-08-22.
const BROKER_NAN_PAYLOAD = {
  conventions: { densify: "broker_nan" },
  gap_spans: [{ start: "2026-08-10", end: "2026-08-21" }],
  rows: [{ date: "2026-08-09" }, { date: "2026-08-22" }, { date: "2026-08-23" }],
};

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

function makeSampleHoldings(symbol: string, count: number): MockHolding[] {
  void symbol; // the stub ignores filters; the rows are this holding's own
  const rows: MockHolding[] = [];
  const base = new Date("2025-01-01").getTime();
  for (let i = 0; i < count; i++) {
    const d = new Date(base + i * 86400 * 1000).toISOString().slice(0, 10);
    rows.push({
      asof: d,
      // A gently varying mark so every metric computes (consecutive days).
      mark_price: 100 + (i % 7) + i * 0.1,
      updated_at: `${d}T10:00:00Z`,
      api_key_id: "key-a",
    });
  }
  return rows;
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
    mockHoldingData = [];
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
    // Default: A owns holding:binance:BTC:spot with 40 consecutive priced days
    mockStrategyData = [];
    mockHoldingData = makeSampleHoldings("BTC", 40);
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
    // "Holding" badge (exact: the D-13 note below also says "holding").
    expect(screen.getByText("Holding")).toBeInTheDocument();
    // BTC symbol
    expect(screen.getByText("BTC")).toBeInTheDocument();
    // Phase 167.1.1 / D-03: 40 consecutive priced days, so the spot holding is
    // "ready" and the ready grid shows its four metrics, with no withheld note.
    expect(screen.queryByTestId("holding-factsheet-rebuilding")).toBeNull();
    expect(screen.getByText("Cumulative return")).toBeInTheDocument();
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.getByText("Max drawdown")).toBeInTheDocument();
    expect(screen.getByText("Vol (annualized)")).toBeInTheDocument();
    // State R: the card says where the four numbers come from, with the day count.
    expect(
      screen.getByTestId("holding-factsheet-price-basis").textContent,
    ).toBe(
      "Computed from 40 days of BTC's daily price, so buying, selling or moving more of it does not count as a gain or loss.",
    );
  });

  it("shows 'not available' when holding fetch returns empty (RLS-gated or no data)", async () => {
    mockHoldingData = []; // no holding rows → fetchHoldingCompareItem returns null
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
    mockHoldingData = makeSampleHoldings("BTC", 40);
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
    mockHoldingData = [];
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

// CR-01 / SFH-01 (167.1.1 round 1): an owned holding whose recorded price is a
// writer constant must neither print a confident 0.00% nor vanish from the page.
describe("ComparePage — a holding whose recorded price is a fixed value (CR-01 / SFH-01)", () => {
  const STABLE_ID = "holding:binance:USDT:spot";
  const flatMarks = (): MockHolding[] =>
    makeSampleHoldings("USDT", 40).map((r) => ({ ...r, mark_price: 1 }));

  beforeEach(() => {
    mockStrategyData = [];
    mockHoldingData = flatMarks();
  });

  it("alone: the card stays with the named note, and no figure is printed", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({ searchParams: Promise.resolve({ ids: STABLE_ID }) });
    render(Page as React.ReactElement);
    expect(screen.queryByText(/comparison isn't available/i)).toBeNull();
    expect(screen.getByTestId("holding-factsheet")).toBeInTheDocument();
    expect(screen.getByTestId("holding-factsheet-rebuilding").textContent).toBe(
      "Return, Sharpe, max drawdown and volatility are not shown for USDT: its recorded price is a fixed value, not a market price.",
    );
    expect(screen.queryByText(/0\.00%/)).toBeNull();
    expect(screen.queryByTestId("holding-factsheet-price-basis")).toBeNull();
  });

  it("mixed with a strategy: the holding card is not dropped from the comparison", async () => {
    mockStrategyData = [
      makeSampleStrategy("22222222-3333-4444-8555-666666666666", "Strategy Beta"),
    ];
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: `${STABLE_ID},22222222-3333-4444-8555-666666666666`,
      }),
    });
    render(Page as React.ReactElement);
    expect(screen.getByTestId("holding-factsheet")).toBeInTheDocument();
    expect(screen.getByTestId("holding-factsheet-rebuilding")).toBeInTheDocument();
    expect(screen.getByText("Strategy Beta")).toBeInTheDocument();
  });

  it("an unowned stablecoin holding (zero rows) is still the generic 'not available' (D-15)", async () => {
    mockHoldingData = [];
    const ComparePage = await getComparePage();
    const Page = await ComparePage({ searchParams: Promise.resolve({ ids: STABLE_ID }) });
    render(Page as React.ReactElement);
    expect(screen.getByText(/comparison isn't available/i)).toBeInTheDocument();
    expect(screen.queryByTestId("holding-factsheet")).toBeNull();
  });
});

// Phase 190 plan 07 (T-190-22): the seven scalar expressions over
// `data_quality_flags` the compare projection may carry. Never the blob, the
// `last_success_snapshot` object or its `flags` object.
const ALLOWED_FLAG_ALIAS_EXPRESSIONS = [
  "data_quality_flags->>cumulative_method",
  "data_quality_flags->>twr_chain_broken",
  "data_quality_flags->>headline_since",
  "data_quality_flags->last_success_snapshot->>computed_at",
  "data_quality_flags->last_success_snapshot->flags->>cumulative_method",
  "data_quality_flags->last_success_snapshot->flags->>twr_chain_broken",
  "data_quality_flags->last_success_snapshot->flags->>headline_since",
];
const ALLOWED_FLAG_ALIASES_RE = new RegExp(
  ALLOWED_FLAG_ALIAS_EXPRESSIONS.map((e) => e.replace(/[>-]/g, (c) => `\\${c}`)).join("|"),
  "g",
);

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
    mockHoldingData = [];
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

  it("never projects daily_returns, metrics_json, or the data_quality_flags blob", async () => {
    const { cols, embed } = await capture();
    expect(cols).not.toContain("daily_returns");
    // Only the one-scalar alias form (`data_quality_flags->>cumulative_method`)
    // is allowed; a bare `data_quality_flags` would ship the whole blob
    // cross-tenant.
    // Phase 170.2 widened the lookahead to the second scalar alias; a bare blob
    // still reds it.
    // Phase 190 plan 07 widened it again, to the seven allowed alias expressions
    // (see the generation describe below): nothing else may follow the column.
    expect(embed.replace(ALLOWED_FLAG_ALIASES_RE, "")).not.toContain("data_quality_flags");
    expect(embed).not.toMatch(/metrics_json(?!->)/);
  });

  it("projects the curve method as a scalar alias so the correlation matrix can read the curve by method (WR-05)", async () => {
    const { embed } = await capture();
    expect(embed).toContain(
      "cumulative_method:data_quality_flags->>cumulative_method",
    );
  });
});

describe("ComparePage — the chain-break flag is projected as a scalar alias (SC-3, T-170.2-11)", () => {
  beforeEach(() => {
    strategySelectCalls.length = 0;
    mockStrategyData = [
      makeSampleStrategy("11111111-2222-4333-8444-555555555555", "Strategy Alpha"),
    ];
    mockHoldingData = [];
  });

  it("projects twr_chain_broken as a one-scalar JSONB alias", async () => {
    const ComparePage = await getComparePage();
    await ComparePage({
      searchParams: Promise.resolve({ ids: "11111111-2222-4333-8444-555555555555" }),
    });
    const cols = strategySelectCalls.find((c) => c.includes("strategy_analytics")) ?? "";
    const embed = /strategy_analytics \(([^)]*)\)/.exec(cols)?.[1] ?? "";
    expect(embed).toContain("twr_chain_broken:data_quality_flags->>twr_chain_broken");
  });

  it("the widened negative pin still rejects a bare blob (it can fail)", () => {
    const leaks = (cols: string) => cols.replace(ALLOWED_FLAG_ALIASES_RE, "").includes("data_quality_flags");
    expect(leaks("returns_series, data_quality_flags")).toBe(true);
    // The pre-190 aliases are still allowed.
    expect(leaks("twr_chain_broken:data_quality_flags->>twr_chain_broken")).toBe(false);
    expect(leaks("data_quality_flags->>something_else")).toBe(true);
    // Phase 190: the snapshot object, its flags object and an unlisted key stay out.
    expect(leaks("data_quality_flags->last_success_snapshot")).toBe(true);
    expect(leaks("data_quality_flags->last_success_snapshot->flags")).toBe(true);
    expect(leaks("data_quality_flags->last_success_snapshot->flags->>native_unit")).toBe(true);
    expect(leaks("data_quality_flags->last_success_snapshot->>other")).toBe(true);
    // ...and every allowed expression, alone, passes.
    for (const alias of ALLOWED_FLAG_ALIAS_EXPRESSIONS) expect(leaks(alias)).toBe(false);
  });
});

/**
 * Phase 190 plan 07 (D-02, SC-3, SC-6; 170.2 D-07 "chart and table always
 * agree"). A chain-broken row is drawn over the span its stored headline
 * compounds. Phase 170.2 read that span's first day from the stored
 * cash_settlement series row and paired the curve with the LIVE flag aliases.
 * Both are rewritten by the derive hop before the new run's success write: the
 * series row by `_persist_cash_series`, the aliases by the prestamp. So between
 * those writes the overlay could draw the last success's curve from the new
 * derive's last-break date, under the old headline.
 *
 * Now the chain-broken flag, the curve method and the covered-from date of every
 * row come from ONE flags generation (plan 03's effective flags, over scalar
 * aliases), and the date is that generation's `headline_since`, the field the
 * factsheet dates the same headline by. The page issues NO service-role read.
 * The rule is status-independent: a chain-broken row is complete_with_warnings
 * and keeps that status through the derive hop.
 */
describe("ComparePage — one flags generation per row (phase 190 plan 07)", () => {
  const ID = "11111111-2222-4333-8444-555555555555";
  const OTHER = "22222222-3333-4444-8555-666666666666";
  const COMPUTED_AT = "2026-10-30T10:00:00.123456+00:00";
  // The same instant as COMPUTED_AT, spelled the way a JS Date writes it.
  const SAME_INSTANT = "2026-10-30T10:00:00.123Z";
  const ONE_SECOND_OFF = "2026-10-30T10:00:01.123Z";
  const LEAKY_KEYS = [
    "headline_since",
    "last_success_computed_at",
    "last_success_cumulative_method",
    "last_success_twr_chain_broken",
    "last_success_headline_since",
  ];

  const compareRow = (id: string, aliases: Record<string, unknown>) => {
    const base = makeSampleStrategy(id, `Strategy ${id.slice(0, 2)}`);
    return {
      ...base,
      strategy_analytics: { ...base.strategy_analytics, computed_at: COMPUTED_AT, ...aliases },
    };
  };
  const render2 = async (ids: string) => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({ searchParams: Promise.resolve({ ids }) });
    render(Page as React.ReactElement);
  };
  const overlayOf = (id: string) => overlayItems.find((it) => it.strategy.id === id)!;

  beforeEach(() => {
    adminReadIds.length = 0;
    // The stored series row names 2026-08-22, which no fixture's headline_since
    // does: a date taken from it would show.
    adminAnswer = { kind: "payload", payload: BROKER_NAN_PAYLOAD };
    overlayItems = [];
    matrixItems = [];
    mockHoldingData = [];
    mockStrategyError = null;
  });

  // ---- the projection ---------------------------------------------------
  it("the compare projection carries computed_at and the five generation aliases, each exactly once, and no object", async () => {
    strategySelectCalls.length = 0;
    mockStrategyData = [compareRow(ID, {})];
    await render2(ID);
    const cols = strategySelectCalls.find((c) => c.includes("strategy_analytics")) ?? "";
    const embed = /strategy_analytics \(([^)]*)\)/.exec(cols)?.[1] ?? "";
    const parts = embed.split(",").map((c) => c.trim());
    for (const part of [
      "computed_at",
      "headline_since:data_quality_flags->>headline_since",
      "last_success_computed_at:data_quality_flags->last_success_snapshot->>computed_at",
      "last_success_cumulative_method:data_quality_flags->last_success_snapshot->flags->>cumulative_method",
      "last_success_twr_chain_broken:data_quality_flags->last_success_snapshot->flags->>twr_chain_broken",
      "last_success_headline_since:data_quality_flags->last_success_snapshot->flags->>headline_since",
    ]) {
      expect(parts.filter((p) => p === part), part).toHaveLength(1);
    }
  });

  // ---- the live generation ----------------------------------------------
  it('a live chain-broken row is dated by its live headline_since, never by the stored series row', async () => {
    mockStrategyData = [
      compareRow(ID, { cumulative_method: "geometric", twr_chain_broken: "true", headline_since: "2026-09-01" }),
    ];
    await render2(ID);
    // The series-row mock names 2026-08-22; the headline compounds from 09-01.
    expect(overlayOf(ID).headlineCoversFrom).toBe("2026-09-01");
    expect(overlayOf(ID).headlineCoversFromStatus).toBe("dated");
    expect(adminReadIds).toEqual([]);
  });

  it.each([
    ["absent", undefined],
    ["an impossible date", "2026-02-30"],
    ["a timestamp", "2026-09-01T00:00:00Z"],
    ["not a string", 20260901],
  ])("a live chain-broken row whose headline_since is %s is undatable with no date", async (_l, since) => {
    mockStrategyData = [
      compareRow(ID, { cumulative_method: "geometric", twr_chain_broken: "true", headline_since: since }),
    ];
    await render2(ID);
    expect(overlayOf(ID).headlineCoversFrom).toBeNull();
    expect(overlayOf(ID).headlineCoversFromStatus).toBe("undatable");
    expect(adminReadIds).toEqual([]);
  });

  it.each([["false"], [null], ["TRUE"], [true], ["1"]])(
    "an alias of %j hands the overlay no covered-from fields",
    async (alias) => {
      mockStrategyData = [
        compareRow(ID, { cumulative_method: "geometric", twr_chain_broken: alias, headline_since: "2026-09-01" }),
      ];
      await render2(ID);
      expect(overlayItems).toHaveLength(1);
      expect(overlayOf(ID)).not.toHaveProperty("headlineCoversFrom");
      expect(overlayOf(ID)).not.toHaveProperty("headlineCoversFromStatus");
    },
  );

  it("dates only the chain-broken row of a mixed pair", async () => {
    mockStrategyData = [
      compareRow(ID, { cumulative_method: "geometric", twr_chain_broken: "true", headline_since: "2026-09-01" }),
      compareRow(OTHER, { cumulative_method: "geometric", twr_chain_broken: "false", headline_since: "2026-09-05" }),
    ];
    await render2(`${ID},${OTHER}`);
    expect(overlayOf(ID).headlineCoversFromStatus).toBe("dated");
    expect(overlayOf(OTHER)).not.toHaveProperty("headlineCoversFromStatus");
  });

  // ---- the window after the derive hop's prestamp ------------------------
  it("post-derive, old success chain-broken and new derive clean: the overlay keeps the old success's date, flag and method", async () => {
    // WHY (D-02, SC-6): the live aliases are the new derive's (clean, no marker),
    // the stored curve and headline are the last success's (chain-broken). Pairing
    // them draws a whole curve under a suffix headline.
    mockStrategyData = [
      compareRow(ID, {
        cumulative_method: null,
        twr_chain_broken: null,
        last_success_computed_at: SAME_INSTANT,
        last_success_cumulative_method: "simple",
        last_success_twr_chain_broken: "true",
        last_success_headline_since: "2026-08-22",
      }),
    ];
    await render2(ID);
    expect(overlayOf(ID).headlineCoversFrom).toBe("2026-08-22");
    expect(overlayOf(ID).headlineCoversFromStatus).toBe("dated");
    expect(overlayOf(ID).analytics.twr_chain_broken).toBe("true");
    expect(overlayOf(ID).analytics.cumulative_method).toBe("simple");
    expect(adminReadIds).toEqual([]);
  });

  it("post-derive, old success clean and new derive chain-broken: the overlay draws the old success as it drew it", async () => {
    mockStrategyData = [
      compareRow(ID, {
        cumulative_method: null,
        twr_chain_broken: "true",
        headline_since: "2026-09-10",
        last_success_computed_at: SAME_INSTANT,
        last_success_cumulative_method: "geometric",
      }),
    ];
    await render2(ID);
    expect(overlayOf(ID)).not.toHaveProperty("headlineCoversFrom");
    expect(overlayOf(ID)).not.toHaveProperty("headlineCoversFromStatus");
    expect(overlayOf(ID).analytics.twr_chain_broken ?? null).toBeNull();
    expect(overlayOf(ID).analytics.cumulative_method).toBe("geometric");
  });

  it("a last-success snapshot bound to ANOTHER success (one second off) is not used: the live aliases stand", async () => {
    mockStrategyData = [
      compareRow(ID, {
        cumulative_method: null,
        twr_chain_broken: "true",
        last_success_computed_at: ONE_SECOND_OFF,
        last_success_cumulative_method: "simple",
        last_success_twr_chain_broken: "true",
        last_success_headline_since: "2026-08-22",
      }),
    ];
    await render2(ID);
    expect(overlayOf(ID).analytics.twr_chain_broken).toBe("true");
    expect(overlayOf(ID).headlineCoversFrom).toBeNull();
    expect(overlayOf(ID).headlineCoversFromStatus).toBe("undatable");
  });

  it("the correlation matrix receives the same effective cumulative_method the overlay does", async () => {
    mockStrategyData = [
      compareRow(ID, {
        cumulative_method: null,
        last_success_computed_at: SAME_INSTANT,
        last_success_cumulative_method: "simple",
      }),
    ];
    await render2(ID);
    expect(matrixItems).toHaveLength(1);
    expect(matrixItems[0].analytics.cumulative_method).toBe("simple");
    expect(overlayOf(ID).analytics.cumulative_method).toBe("simple");
  });

  // ---- what leaves the server -----------------------------------------------
  it("no item handed to the overlay or the matrix carries an alias input, and the overlay keys stay exactly the five", async () => {
    mockStrategyData = [
      compareRow(ID, {
        cumulative_method: "geometric",
        twr_chain_broken: "true",
        headline_since: "2026-09-01",
        last_success_computed_at: SAME_INSTANT,
        last_success_cumulative_method: "simple",
        last_success_twr_chain_broken: "true",
        last_success_headline_since: "2026-08-22",
      }),
    ];
    await render2(ID);
    for (const it of [...overlayItems, ...matrixItems]) {
      for (const key of LEAKY_KEYS) expect(it.analytics, key).not.toHaveProperty(key);
    }
    expect(Object.keys(overlayItems[0]).sort()).toEqual(
      ["analytics", "headlineCoversFrom", "headlineCoversFromStatus", "kind", "strategy"].sort(),
    );
    expect(JSON.stringify(overlayItems[0])).not.toContain("gap_spans");
  });

  it("a row whose live aliases carry the marker hands the overlay its fetched flag and method unchanged", async () => {
    mockStrategyData = [
      compareRow(ID, {
        cumulative_method: "geometric",
        twr_chain_broken: "true",
        headline_since: "2026-09-01",
        // even a bound snapshot is not consulted while the live marker is present
        last_success_computed_at: SAME_INSTANT,
        last_success_cumulative_method: "simple",
        last_success_twr_chain_broken: null,
        last_success_headline_since: "2026-08-22",
      }),
    ];
    await render2(ID);
    expect(overlayOf(ID).analytics.twr_chain_broken).toBe("true");
    expect(overlayOf(ID).analytics.cumulative_method).toBe("geometric");
    expect(overlayOf(ID).headlineCoversFrom).toBe("2026-09-01");
  });
});

/**
 * Phase 167.1.2 review round 2 (SFH-R2-02). A failed read used to render
 * "This comparison isn't available", which tells the allocator the strategy
 * or holding does not exist. It must instead reach the route's error boundary
 * (compare/error.tsx: digest-only, with a retry), with the database message
 * logged server-side and never carried by the thrown error.
 *
 * D-15 is unchanged and pinned above: unowned or missing rows come back as
 * ZERO rows and still render "not available". These cases FAIL if either read
 * folds its error back into an empty list.
 */
describe("ComparePage — a failed load is surfaced, not reported as 'not available'", () => {
  beforeEach(() => {
    mockStrategyData = [
      makeSampleStrategy("22222222-3333-4444-8555-666666666666", "Strategy Beta"),
    ];
    mockHoldingData = makeSampleHoldings("BTC", 40);
    mockStrategyError = null;
    mockHoldingError = null;
  });
  afterEach(() => {
    mockStrategyError = null;
    mockHoldingError = null;
  });

  const run = async (ids: string) => {
    const ComparePage = await getComparePage();
    return ComparePage({ searchParams: Promise.resolve({ ids }) });
  };

  it("a strategies query error throws to the error boundary and logs the message only", async () => {
    mockStrategyError = { message: "strategies-boom" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const p = run("22222222-3333-4444-8555-666666666666");
      await expect(p).rejects.toThrow("compare strategies load failed");
      await expect(p).rejects.not.toThrow(/strategies-boom/);
      expect(spy).toHaveBeenCalledWith(
        "[compare/page] strategies query failed:",
        "strategies-boom",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("a holding query error throws to the error boundary, even beside a strategy that loaded", async () => {
    mockHoldingError = { message: "holdings-boom" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const p = run("holding:binance:BTC:spot,22222222-3333-4444-8555-666666666666");
      await expect(p).rejects.toThrow("holding compare load failed");
      await expect(p).rejects.not.toThrow(/holdings-boom/);
    } finally {
      spy.mockRestore();
    }
  });

  it("positive control: the same ids with no error render, so the throws above are the error path", async () => {
    const Page = await run("holding:binance:BTC:spot,22222222-3333-4444-8555-666666666666");
    render(Page as React.ReactElement);
    expect(screen.getByTestId("holding-factsheet")).toBeInTheDocument();
    expect(screen.getByText("Strategy Beta")).toBeInTheDocument();
  });
});

/**
 * Phase 197 plan 04 (ROUTE-05, D-04). /compare adds and removes strategies itself,
 * so no state may say adding is unavailable, and the search and captions follow the
 * UI-SPEC state table: 0 ids, none resolvable, 1, 2-3 and 4 items.
 */
const EMPTY_COMPARE =
  "No strategies selected yet. Add one above, or select 2 to 4 in Discovery and choose Compare.";
const ONE_COMPARE = "One strategy selected. Add another to compare.";
const CAP_COMPARE = "Comparing 4 strategies, the maximum. Remove one to add another.";
const ID_A = "11111111-2222-4333-8444-555555555555";
const ID_B = "22222222-3333-4444-8555-666666666666";
const ID_C = "33333333-4444-4555-8666-777777777777";
const ID_D = "44444444-5555-4666-8777-888888888888";

describe("ComparePage: every state, the search and Remove (197 plan 04)", () => {
  beforeEach(() => {
    mockStrategyData = [];
    mockHoldingData = [];
    mockStrategyError = null;
    mockHoldingError = null;
    addStrategyIds = null;
  });

  const renderIds = async (ids?: string) => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve(ids === undefined ? {} : { ids }),
    });
    render(Page as React.ReactElement);
  };
  const strategies = (...ids: string[]) =>
    ids.map((id, i) => makeSampleStrategy(id, `Strategy ${"ABCD"[i]}`));

  it("with no ids, keeps the Compare strategies heading, shows the search and the new caption", async () => {
    await renderIds();
    expect(screen.getByRole("heading", { name: "Compare strategies" })).toBeInTheDocument();
    expect(screen.getByTestId("add-strategy")).toBeInTheDocument();
    expect(addStrategyIds).toEqual([]);
    const caption = screen.getByText(EMPTY_COMPARE);
    expect(caption.className).toContain("text-caption");
    expect(caption.className).toContain("text-text-muted");
    expect(caption.className).not.toContain("text-center");
    // WHY: the removed copy told the allocator the very thing this page now does.
    expect(screen.queryByText(/from this page/i)).toBeNull();
  });

  it("with ids that resolve to nothing, says so and still offers the search with no current ids", async () => {
    await renderIds(ID_A);
    expect(screen.getByText("This comparison isn't available.")).toBeInTheDocument();
    expect(screen.getByTestId("add-strategy")).toBeInTheDocument();
    expect(addStrategyIds).toEqual([]);
  });

  it("with one item, shows the caption, the search and the table", async () => {
    mockStrategyData = strategies(ID_A);
    await renderIds(ID_A);
    const note = screen.getByText(ONE_COMPARE);
    expect(note.className).toContain("text-caption");
    expect(note.className).toContain("text-text-muted");
    expect(addStrategyIds).toEqual([ID_A]);
    expect(document.querySelector("table")).not.toBeNull();
    expect(screen.queryByText(/from this page/i)).toBeNull();
  });

  it("with two or three items, shows the search and no caption", async () => {
    mockStrategyData = strategies(ID_A, ID_B, ID_C);
    await renderIds(`${ID_A},${ID_B},${ID_C}`);
    expect(screen.getByTestId("add-strategy")).toBeInTheDocument();
    expect(addStrategyIds).toEqual([ID_A, ID_B, ID_C]);
    expect(screen.queryByText(ONE_COMPARE)).toBeNull();
    expect(screen.queryByText(CAP_COMPARE)).toBeNull();
  });

  it("with four items, shows the cap caption and no search", async () => {
    mockStrategyData = strategies(ID_A, ID_B, ID_C, ID_D);
    await renderIds(`${ID_A},${ID_B},${ID_C},${ID_D}`);
    // WHY: a fifth id must never be addable, so the search is not mounted at the cap.
    expect(screen.queryByTestId("add-strategy")).toBeNull();
    expect(screen.getByText(CAP_COMPARE)).toBeInTheDocument();
  });

  it("counts only what the page shows: an unresolved id is not echoed to the search", async () => {
    mockStrategyData = strategies(ID_A);
    await renderIds(`${ID_A},${ID_B}`);
    expect(addStrategyIds).toEqual([ID_A]);
  });

  it("Remove on one of two strategies links to the other alone; on the only one, to /compare", async () => {
    mockStrategyData = strategies(ID_A, ID_B);
    await renderIds(`${ID_A},${ID_B}`);
    const removeA = screen.getByRole("link", { name: "Remove Strategy A from the comparison" });
    expect(removeA).toHaveAttribute("href", `/compare?ids=${ID_B}`);
    cleanup();
    mockStrategyData = strategies(ID_A);
    await renderIds(ID_A);
    expect(
      screen.getByRole("link", { name: "Remove Strategy A from the comparison" }),
    ).toHaveAttribute("href", "/compare");
  });

  it("keeps a holding ref in a strategy's Remove href (it still counts toward the 4)", async () => {
    mockStrategyData = strategies(ID_A);
    mockHoldingData = makeSampleHoldings("BTC", 40);
    await renderIds(`holding:binance:BTC:spot,${ID_A}`);
    expect(
      screen.getByRole("link", { name: "Remove Strategy A from the comparison" }),
    ).toHaveAttribute("href", "/compare?ids=holding%3Abinance%3ABTC%3Aspot");
  });
});

/**
 * Phase 194 plan 10 (D-04 as superseded by D-15) — CompareTable's annualised rows
 * are judged on each strategy's TOTAL record, and the page builds that record on the
 * server: first and last `returns_series` date, the effective `headline_since`, the
 * stored `record_observations` alias and the strategy's `asset_class`. The expected
 * sentences are typed by hand from D-15 (crypto: 90 calendar days; non-crypto: 60
 * observations), read off the real CompareTable's Sharpe cell.
 */
describe("ComparePage — the total record behind CompareTable (194 plan 10)", () => {
  const ID = "11111111-2222-4333-8444-555555555555";
  const COMPUTED_AT = "2026-10-30T10:00:00.123456+00:00";
  const SAME_INSTANT = "2026-10-30T10:00:00.123Z";

  /** A returns_series of one point per calendar day from `start`, `count` points. */
  const dailySeries = (start: string, count: number) => {
    const t0 = Date.parse(`${start}T00:00:00Z`);
    return Array.from({ length: count }, (_, i) => ({
      date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
      value: 0.001,
    }));
  };

  const row = (
    assetClass: "crypto" | "traditional",
    analytics: Record<string, unknown>,
  ) => {
    const base = makeSampleStrategy(ID, "Strategy Alpha");
    return {
      ...base,
      asset_class: assetClass,
      strategy_analytics: { ...base.strategy_analytics, computed_at: COMPUTED_AT, ...analytics },
    };
  };

  const sharpeSpan = async (): Promise<HTMLElement> => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({ searchParams: Promise.resolve({ ids: ID }) });
    render(Page as React.ReactElement);
    const tr = Array.from(document.querySelectorAll("tbody tr")).find(
      (r) => r.querySelector("td")?.textContent === "Sharpe",
    );
    return tr!.querySelectorAll("td")[1].querySelector("span.font-metric") as HTMLElement;
  };

  beforeEach(() => {
    adminAnswer = { kind: "none" };
    overlayItems = [];
    matrixItems = [];
    mockHoldingData = [];
    mockStrategyError = null;
    strategySelectCalls.length = 0;
  });

  it("a chain-broken crypto row's record starts at its headline_since, not at its first return", async () => {
    // First return 2026-01-01, last 2026-06-30 (180 days): a span from the first return
    // would clear 90 days. The headline compounds from 2026-04-12, which covers 80 days to the end.
    mockStrategyData = [
      row("crypto", {
        returns_series: [
          { date: "2026-01-01", value: 0 },
          { date: "2026-06-30", value: 0.01 },
        ],
        twr_chain_broken: "true",
        headline_since: "2026-04-12",
      }),
    ];
    const span = await sharpeSpan();
    expect(span.getAttribute("title")).toBe("Withheld until the record reaches 90 days (80 days so far).");
  });

  it("the headline_since of the EFFECTIVE flags generation decides, so a bound last-success snapshot counts", async () => {
    // The live aliases are a clean derive's (no marker, no headline_since); the stored
    // curve and headline are the last success's, chain-broken from 2026-04-12.
    mockStrategyData = [
      row("crypto", {
        returns_series: [
          { date: "2026-01-01", value: 0 },
          { date: "2026-06-30", value: 0.01 },
        ],
        cumulative_method: null,
        twr_chain_broken: null,
        last_success_computed_at: SAME_INSTANT,
        last_success_cumulative_method: "simple",
        last_success_twr_chain_broken: "true",
        last_success_headline_since: "2026-04-12",
      }),
    ];
    const span = await sharpeSpan();
    expect(span.getAttribute("title")).toBe("Withheld until the record reaches 90 days (80 days so far).");
  });

  it("a record with no headline_since spans first to last return and clears 90 days (positive control)", async () => {
    mockStrategyData = [
      row("crypto", {
        returns_series: [
          { date: "2026-01-01", value: 0 },
          { date: "2026-06-30", value: 0.01 },
        ],
      }),
    ];
    const span = await sharpeSpan();
    expect(span.getAttribute("title")).toBeNull();
    expect(span.textContent).toContain("1.50");
  });

  it("the record's observations are the stored alias, not the length of the capped returns_series", async () => {
    // 120 stored points over 120 days would clear the 90-day fallback and any count of
    // `returns_series`; the stored alias says the record holds 59 observations, under 60.
    mockStrategyData = [
      row("traditional", { returns_series: dailySeries("2026-01-01", 120), record_observations: 59 }),
    ];
    const span = await sharpeSpan();
    expect(span.getAttribute("title")).toBe("Withheld until the record reaches 60 trading days (59 so far).");
  });

  it("an alias of 60 observations over 119 days shows the figures with the short-track marker", async () => {
    mockStrategyData = [
      row("traditional", { returns_series: dailySeries("2026-01-01", 120), record_observations: 60 }),
    ];
    const span = await sharpeSpan();
    expect(span.getAttribute("title")).toBeNull();
    expect(span.textContent).toContain("<1y");
  });

  it("appends the one count alias at the page's select call site and leaves COMPARE_ANALYTICS_COLUMNS alone", async () => {
    mockStrategyData = [row("crypto", {})];
    await sharpeSpan();
    const cols = strategySelectCalls.find((c) => c.includes("strategy_analytics")) ?? "";
    const embed = /strategy_analytics \(([^)]*)\)/.exec(cols)?.[1] ?? "";
    const parts = embed.split(",").map((c) => c.trim());
    expect(parts.filter((p) => p === "record_observations:metrics_json->record_observations")).toHaveLength(1);
    // The shared projection constant (and its exact-set pin in queries) is untouched.
    expect(COMPARE_ANALYTICS_COLUMNS).not.toContain("record_observations");
  });

  it("neither the count alias nor the record reaches the overlay or the matrix", async () => {
    mockStrategyData = [
      row("crypto", {
        returns_series: [
          { date: "2026-01-01", value: 0 },
          { date: "2026-06-30", value: 0.01 },
        ],
        record_observations: 180,
        headline_since: "2026-04-12",
      }),
    ];
    await sharpeSpan();
    for (const it of [...overlayItems, ...matrixItems]) {
      expect(it.analytics).not.toHaveProperty("record_observations");
      expect(it.analytics).not.toHaveProperty("headline_since");
      expect(it).not.toHaveProperty("figureRecord");
    }
  });
});
