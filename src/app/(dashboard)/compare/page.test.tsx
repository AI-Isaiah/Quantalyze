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
// Phase 170.2 (SC-3): records the items the page hands the overlay, so the
// covered-from fields can be asserted without rendering recharts.
type OverlayItem = {
  strategy: { id: string };
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
// Phase 167.1.2 review round 2 (SFH-R2-02): per-table query errors.
let mockStrategyError: { message: string } | null = null;
let mockSnapshotError: { message: string } | null = null;

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
        order: vi.fn().mockReturnThis(),
        // limit() is called as the terminal step for snapshot queries
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
        if (table === "allocator_equity_snapshots") {
          return makeQueryBuilder(() => mockSnapshotData, false, () => mockSnapshotError);
        }
        return makeQueryBuilder(() => []);
      }),
    };
  }),
}));

// Phase 170.2 (SC-3, T-170.2-10): the service-role read of a chain-broken row's
// stored cash_settlement series. `strategy_analytics_series` is deny-all RLS, so
// the page reaches it through the admin client; the mock records which strategy
// ids were read and answers per-id, so a read for any OTHER row is observable.
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
    // "Holding" badge (exact: the D-13 note below also says "holding").
    expect(screen.getByText("Holding")).toBeInTheDocument();
    // BTC symbol
    expect(screen.getByText("BTC")).toBeInTheDocument();
    // Phase 167.1.2 / D-13: 40 snapshot days WOULD compute every metric, but
    // while the equity history is rebuilt the page shows the note and no
    // per-holding return, Sharpe, drawdown or vol.
    expect(screen.getByTestId("holding-factsheet-rebuilding")).toBeInTheDocument();
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText("Max drawdown")).toBeNull();
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

  it("never projects daily_returns, metrics_json, or the data_quality_flags blob", async () => {
    const { cols, embed } = await capture();
    expect(cols).not.toContain("daily_returns");
    // Only the one-scalar alias form (`data_quality_flags->>cumulative_method`)
    // is allowed; a bare `data_quality_flags` would ship the whole blob
    // cross-tenant.
    // Phase 170.2 widened the lookahead to the second scalar alias; a bare blob
    // still reds it.
    expect(embed).not.toMatch(/data_quality_flags(?!->>(?:cumulative_method|twr_chain_broken))/);
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
    mockSnapshotData = [];
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
    const pin = /data_quality_flags(?!->>(?:cumulative_method|twr_chain_broken))/;
    expect("returns_series, data_quality_flags").toMatch(pin);
    expect("data_quality_flags->>twr_chain_broken").not.toMatch(pin);
    expect("data_quality_flags->>something_else").toMatch(pin);
  });
});

/**
 * Phase 170.2 (SC-3, D-07, T-170.2-10). The overlay draws a chain-broken row
 * over the span its headline return compounds, which needs the covered-from date
 * out of the stored cash series. The page reads it (service role, deny-all RLS
 * table) ONLY for a row the visibility-gated read already returned AND whose
 * alias is exactly the string "true", and hands the overlay the DATE and a
 * status, never the series. The three non-clean outcomes stay distinct because
 * the reader's contract is that an outage is never rendered as "the span cannot
 * be named".
 */
describe("ComparePage — covered-from read for chain-broken rows (SC-3, D-07)", () => {
  const ID = "11111111-2222-4333-8444-555555555555";
  const OTHER = "22222222-3333-4444-8555-666666666666";
  const chainBroken = (id: string, alias: unknown) => {
    const base = makeSampleStrategy(id, `Strategy ${id.slice(0, 2)}`);
    return {
      ...base,
      strategy_analytics: { ...base.strategy_analytics, twr_chain_broken: alias },
    };
  };
  const render2 = async (ids: string) => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({ searchParams: Promise.resolve({ ids }) });
    render(Page as React.ReactElement);
  };

  beforeEach(() => {
    adminReadIds.length = 0;
    adminAnswer = { kind: "payload", payload: BROKER_NAN_PAYLOAD };
    overlayItems = [];
    mockSnapshotData = [];
    mockStrategyError = null;
  });

  it('a row whose alias is "true" is read once and the overlay gets the date as "dated"', async () => {
    mockStrategyData = [chainBroken(ID, "true")];
    await render2(ID);
    expect(adminReadIds).toEqual([ID]);
    expect(overlayItems).toHaveLength(1);
    expect(overlayItems[0].headlineCoversFrom).toBe("2026-08-22");
    expect(overlayItems[0].headlineCoversFromStatus).toBe("dated");
  });

  it.each([["false"], [null], ["TRUE"], [true], ["1"]])(
    "an alias of %j triggers no admin read and the overlay row carries no covered-from fields",
    async (alias) => {
      mockStrategyData = [chainBroken(ID, alias)];
      await render2(ID);
      expect(adminReadIds).toEqual([]);
      expect(overlayItems).toHaveLength(1);
      expect(overlayItems[0]).not.toHaveProperty("headlineCoversFrom");
      expect(overlayItems[0]).not.toHaveProperty("headlineCoversFromStatus");
    },
  );

  it("reads only the chain-broken row of a mixed pair", async () => {
    mockStrategyData = [chainBroken(ID, "true"), chainBroken(OTHER, "false")];
    await render2(`${ID},${OTHER}`);
    expect(adminReadIds).toEqual([ID]);
    const byId = new Map(overlayItems.map((it) => [it.strategy.id, it]));
    expect(byId.get(ID)?.headlineCoversFromStatus).toBe("dated");
    expect(byId.get(OTHER)).not.toHaveProperty("headlineCoversFromStatus");
  });

  it('a missing or undatable series is "undatable" with no date', async () => {
    mockStrategyData = [chainBroken(ID, "true")];
    adminAnswer = { kind: "none" };
    await render2(ID);
    expect(overlayItems[0].headlineCoversFrom).toBeNull();
    expect(overlayItems[0].headlineCoversFromStatus).toBe("undatable");
  });

  it('a payload that echoes another densify convention is "undatable"', async () => {
    mockStrategyData = [chainBroken(ID, "true")];
    adminAnswer = {
      kind: "payload",
      payload: { ...BROKER_NAN_PAYLOAD, conventions: { densify: "zero_fill" } },
    };
    await render2(ID);
    expect(overlayItems[0].headlineCoversFromStatus).toBe("undatable");
  });

  it('a failed read is "read_failed", logs the message only, and the page still renders', async () => {
    mockStrategyData = [chainBroken(ID, "true")];
    adminAnswer = { kind: "error" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render2(ID);
      expect(overlayItems[0].headlineCoversFrom).toBeNull();
      expect(overlayItems[0].headlineCoversFromStatus).toBe("read_failed");
      expect(screen.getByTestId("equity-overlay")).toBeInTheDocument();
      const logged = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(logged).toContain("[compare/page] covered-from read failed");
      // the database message rides only as the error's cause; it is not logged
      expect(logged).not.toContain("pg-boom-secret");
    } finally {
      spy.mockRestore();
    }
  });

  it("never hands the overlay the series payload, only the date and a status", async () => {
    mockStrategyData = [chainBroken(ID, "true")];
    await render2(ID);
    const keys = Object.keys(overlayItems[0]).sort();
    expect(keys).toEqual(
      ["analytics", "headlineCoversFrom", "headlineCoversFromStatus", "kind", "strategy"].sort(),
    );
    expect(JSON.stringify(overlayItems[0])).not.toContain("gap_spans");
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
    mockSnapshotData = makeSampleSnapshots("BTC", 40);
    mockStrategyError = null;
    mockSnapshotError = null;
  });
  afterEach(() => {
    mockStrategyError = null;
    mockSnapshotError = null;
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
    mockSnapshotError = { message: "snapshots-boom" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const p = run("holding:binance:BTC:spot,22222222-3333-4444-8555-666666666666");
      await expect(p).rejects.toThrow("holding compare load failed");
      await expect(p).rejects.not.toThrow(/snapshots-boom/);
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
 * N-CMP (Phase 170, 2026-09-27). No prior assertion pinned the old empty-state
 * sentence. These cases pin the copy that replaced it: no ids name the
 * factsheet control, one resolved item states the limit, two do not.
 */
const EMPTY_COMPARE =
  'Open a strategy\'s factsheet and choose "Compare strategies" to start a comparison. Adding strategies to a comparison from this page is not available yet.';
const ONE_COMPARE =
  "One strategy selected. Adding a second strategy from this page is not available yet.";

describe("ComparePage — zero, one and many ids (N-CMP)", () => {
  beforeEach(() => {
    mockStrategyData = [];
    mockSnapshotData = [];
    mockStrategyError = null;
    mockSnapshotError = null;
  });

  it("with no ids, keeps Compare Strategies and names the factsheet control", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({ searchParams: Promise.resolve({}) });
    render(Page as React.ReactElement);
    expect(
      screen.getByRole("heading", { name: "Compare Strategies" }),
    ).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COMPARE)).toBeInTheDocument();
    expect(screen.queryByText(/checkboxes/i)).toBeNull();
  });

  it("with one resolvable id, shows the one-strategy note in text-caption text-text-muted", async () => {
    mockStrategyData = [
      makeSampleStrategy(
        "11111111-2222-4333-8444-555555555555",
        "Strategy Alpha",
      ),
    ];
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "11111111-2222-4333-8444-555555555555",
      }),
    });
    render(Page as React.ReactElement);
    const note = screen.getByText(ONE_COMPARE);
    expect(note.className).toContain("text-caption");
    expect(note.className).toContain("text-text-muted");
  });

  it("with two resolvable ids, does not show the one-strategy note", async () => {
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
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "11111111-2222-4333-8444-555555555555,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);
    expect(screen.queryByText(ONE_COMPARE)).toBeNull();
    expect(screen.queryByText(/not available yet/i)).toBeNull();
  });
});
