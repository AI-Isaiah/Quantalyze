/**
 * Regression: UAT-03 (Phase 09) — /compare mixed holding + strategy must
 * pass ONLY strategy items to CompareEquityOverlay and CompareCorrelationMatrix.
 *
 * What broke: CompareEquityOverlay and CompareCorrelationMatrix dereference
 * item.strategy unconditionally (they predate Phase 09's discriminated union).
 * Plan 09-04 page.tsx cast `items as never` and passed the full merged array
 * to both components. In production this produced a 500 Server Error when
 * the URL contained a holding id alongside a strategy UUID — the overlay
 * tried to read .strategy.name on the holding item and threw.
 *
 * The original page.test.tsx mocked both chart components as inert stubs,
 * so the crash never surfaced in unit tests. This regression test uses
 * spying mocks to capture the `items` prop each component actually receives
 * and asserts:
 *   1. Both chart components receive a strategy-only slice (no kind==='holding' items)
 *   2. CompareTable receives the full merged slice (it branches on kind)
 *
 * Found by /qa browser testing on 2026-04-21 —
 * /compare?ids=holding:okx:BTC:spot,<uuid> returned 500 in production dev.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: () => React.createElement("h1"),
}));
vi.mock("@/components/layout/Breadcrumb", () => ({
  Breadcrumb: () => React.createElement("nav"),
}));
vi.mock("@/components/strategy/CompareTable", () => ({
  CompareTable: vi.fn(() =>
    React.createElement("div", { "data-testid": "table" }),
  ),
}));
vi.mock("@/components/strategy/CompareEquityOverlay", () => ({
  CompareEquityOverlay: vi.fn(() =>
    React.createElement("div", { "data-testid": "overlay" }),
  ),
}));
vi.mock("@/components/strategy/CompareCorrelationMatrix", () => ({
  CompareCorrelationMatrix: vi.fn(() =>
    React.createElement("div", { "data-testid": "corr" }),
  ),
}));

// Mock supabase/server — user is authed; strategies + snapshots stubbed.
const BTC_SNAPSHOTS = Array.from({ length: 40 }, (_, i) => ({
  asof: `2026-01-${String(i + 1).padStart(2, "0")}`,
  breakdown: { BTC: 60000 + i * 200 },
}));
const PUBLISHED_STRATEGY = {
  id: "22222222-3333-4444-8555-666666666666",
  name: "Strategy Beta",
  status: "published",
  strategy_analytics: null,
};
// Phase 170.2 (SC-3): the strategies read answers whatever this holds, so a
// chain-broken row can be served; reset to the clean row before each case.
let strategyRows: unknown[] = [PUBLISHED_STRATEGY];

// Phase 170.2 (SC-3): the page reads a chain-broken row's covered-from date
// through the admin client (deny-all RLS table). Answers a broker_nan cash
// series whose last gap ends 2026-08-21.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data: {
          payload: {
            conventions: { densify: "broker_nan" },
            gap_spans: [{ start: "2026-08-10", end: "2026-08-21" }],
            rows: [{ date: "2026-08-22" }, { date: "2026-08-23" }],
          },
        },
        error: null,
      }),
    };
    return { from: () => builder };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        // Phase 109 requireRolePage guard (compare is allocator-owned) reads
        // profiles.role first — return an allocator so the guard passes.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { role: "allocator" }, error: null }),
            }),
          }),
        };
      }
      if (table === "strategies") {
        return {
          select: () => ({
            in: () => ({
              eq: () => Promise.resolve({ data: strategyRows, error: null }),
            }),
          }),
        };
      }
      if (table === "allocator_equity_snapshots") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: BTC_SNAPSHOTS, error: null }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) };
    },
  }),
}));

import { CompareEquityOverlay } from "@/components/strategy/CompareEquityOverlay";
import { CompareCorrelationMatrix } from "@/components/strategy/CompareCorrelationMatrix";
import { CompareTable } from "@/components/strategy/CompareTable";

async function getComparePage() {
  const mod = await import("./page");
  return mod.default;
}

describe("ComparePage — UAT-03 strategy-only charts regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    strategyRows = [PUBLISHED_STRATEGY];
  });

  it("passes strategy-only items to CompareEquityOverlay when mixed ids present", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:okx:BTC:spot,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);

    // Overlay must have received only the strategy item.
    expect(CompareEquityOverlay).toHaveBeenCalledTimes(1);
    const overlayItems = (
      (CompareEquityOverlay as unknown as { mock: { calls: Array<[{ items: unknown[] }]> } })
        .mock.calls[0][0]
    ).items as Array<{ kind: string }>;
    expect(overlayItems).toHaveLength(1);
    expect(overlayItems.every((it) => it.kind === "strategy")).toBe(true);
  });

  it("passes strategy-only items to CompareCorrelationMatrix when mixed ids present", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:okx:BTC:spot,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);

    expect(CompareCorrelationMatrix).toHaveBeenCalledTimes(1);
    const corrItems = (
      (CompareCorrelationMatrix as unknown as { mock: { calls: Array<[{ items: unknown[] }]> } })
        .mock.calls[0][0]
    ).items as Array<{ kind: string }>;
    expect(corrItems).toHaveLength(1);
    expect(corrItems.every((it) => it.kind === "strategy")).toBe(true);
  });

  it("passes the full merged items[] to CompareTable (kind branch renders HoldingFactsheet)", async () => {
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:okx:BTC:spot,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);

    expect(CompareTable).toHaveBeenCalledTimes(1);
    const tableItems = (
      (CompareTable as unknown as { mock: { calls: Array<[{ items: unknown[] }]> } })
        .mock.calls[0][0]
    ).items as Array<{ kind: string }>;
    expect(tableItems).toHaveLength(2);
    expect(tableItems.some((it) => it.kind === "holding")).toBe(true);
    expect(tableItems.some((it) => it.kind === "strategy")).toBe(true);
  });

  it("hands the overlay (and only the overlay) the covered-from date of a chain-broken row (SC-3, D-07)", async () => {
    strategyRows = [
      { ...PUBLISHED_STRATEGY, strategy_analytics: { twr_chain_broken: "true" } },
    ];
    const ComparePage = await getComparePage();
    const Page = await ComparePage({
      searchParams: Promise.resolve({
        ids: "holding:okx:BTC:spot,22222222-3333-4444-8555-666666666666",
      }),
    });
    render(Page as React.ReactElement);

    const callItems = (c: unknown) =>
      (c as unknown as { mock: { calls: Array<[{ items: Array<Record<string, unknown>> }]> } })
        .mock.calls[0][0].items;
    const overlay = callItems(CompareEquityOverlay);
    expect(overlay).toHaveLength(1);
    expect(overlay[0].headlineCoversFrom).toBe("2026-08-22");
    expect(overlay[0].headlineCoversFromStatus).toBe("dated");
    for (const other of [CompareCorrelationMatrix, CompareTable]) {
      for (const it of callItems(other)) {
        expect(it).not.toHaveProperty("headlineCoversFrom");
        expect(it).not.toHaveProperty("headlineCoversFromStatus");
      }
    }
  });
});
