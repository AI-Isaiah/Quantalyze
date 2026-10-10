import { describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 164.6.6.2.1 plan 17 (D-09, D-20). When a native-unit account is left
// out of the dollar total because the BTC close for one of its days is not
// stored, the Overview names it: a drop in the total is never silent. The day
// is the one the writer recorded, the labels are the owner's own.
// ---------------------------------------------------------------------------

import { vi } from "vitest";

vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="mock-insight-strip" />,
}));
vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="mock-alert-banner" />,
}));
vi.mock("./widgets/performance/EquityChart", () => ({
  default: () => <div data-testid="mock-equity-chart" />,
}));
vi.mock("@/app/factsheet/[id]/v2/factsheet-context", () => ({
  FactsheetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetBody: () => <div data-testid="mock-factsheet-body" />,
}));
vi.mock("@/lib/factsheet/allocator-portfolio-payload", () => ({
  buildAllocatorPortfolioFactsheetPayload: () => null,
}));

const baseProps = {
  portfolio: {
    id: "p1",
    user_id: "u1",
    name: "Test Portfolio",
    description: null,
    created_at: "2023-01-01T00:00:00Z",
    is_test: false,
  },
  strategies: [],
  analytics: {
    total_aum: 100_000,
    return_ytd: 0.1,
    return_mtd: 0.01,
    portfolio_sharpe: 1.2,
    portfolio_max_drawdown: -0.05,
    portfolio_volatility: 0.15,
    avg_pairwise_correlation: 0.25,
    attribution_breakdown: null,
  } as never,
  apiKeys: [
    {
      id: "k1",
      exchange: "okx",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-05-28T11:00:00Z",
      sync_error: null,
      disconnected_at: null,
      label: "OKX Key",
    },
  ] as never,
  holdingsSummary: [
    {
      symbol: "BTC",
      quantity: 1,
      mark_price_usd: 50_000,
      value_usd: 50_000,
      venue: "okx",
      holding_type: "spot",
      api_key_id: "k1",
      side: null,
      entry_price: null,
      unrealized_pnl_usd: null,
    },
  ] as never,
  flaggedHoldings: [],
  equityDailyPoints: [],
  equitySnapshots: [],
  activeVenues: [],
  snapshotCount: 0,
  minHistoryDepthMonths: 3,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: "2026-05-28T11:00:00Z",
  hasSyncing: false,
} as unknown as MyAllocationDashboardPayload;

type Account = NonNullable<MyAllocationDashboardPayload["unpricedNativeAccounts"]>[number];
/** dated (the default), or a whole-out / history account when a kind is named. */
const A = (label: string, day: string | null = "2026-10-08"): Account =>
  day === null
    ? { apiKeyId: `id-${label}`, label, day: null, kind: "whole" }
    : { apiKeyId: `id-${label}`, label, day, kind: "dated" };
const W = (label: string): Account => A(label, null);
const H = (label: string, holeDays: number): Account => ({
  apiKeyId: `id-${label}`,
  label,
  day: null,
  kind: "history",
  holeDays,
});

const TID = "dashboard-unpriced-account-note";
const TAIL_ONE = "no BTC close is stored for that day yet, so it cannot be priced in USD.";
const TAIL_MANY = "no BTC close is stored for that day yet, so they cannot be priced in USD.";

function renderWith(
  accounts: Account[] | undefined,
  state: "ready" | "rebuilding" = "ready",
  extra: Record<string, unknown> = {},
) {
  return render(
    <AllocationDashboardV2
      {...baseProps}
      equityHistoryState={state}
      unpricedNativeAccounts={accounts}
      {...extra}
    />,
  );
}

describe("AllocationDashboardV2: the account left out of the total is named (164.6.6.2.1 D-20)", () => {
  it("one account: names it and the day", () => {
    renderWith([A("BTC desk")]);
    const note = screen.getByTestId(TID);
    expect(note.textContent).toBe(`The total leaves out BTC desk for Oct 8, 2026: ${TAIL_ONE}`);
    expect(note.getAttribute("role")).toBe("status");
    expect(note.tagName).toBe("P");
    expect(note.className).toBe("mb-3 px-1 text-sm text-text-secondary");
  });

  it("two accounts: joined by ' and ', plural tail", () => {
    renderWith([A("Alpha"), A("BTC desk")]);
    expect(screen.getByTestId(TID).textContent).toBe(
      `The total leaves out Alpha and BTC desk for Oct 8, 2026: ${TAIL_MANY}`,
    );
  });

  it("three or more: commas with ' and ' before the last, no serial comma", () => {
    renderWith([A("A"), A("B"), A("C"), A("D")]);
    expect(screen.getByTestId(TID).textContent).toBe(
      `The total leaves out A, B, C and D for Oct 8, 2026: ${TAIL_MANY}`,
    );
  });

  it("sorts ascending by label whatever order the payload carries", () => {
    renderWith([A("Zed"), A("Alpha"), A("Mid")]);
    expect(screen.getByTestId(TID).textContent).toBe(
      `The total leaves out Alpha, Mid and Zed for Oct 8, 2026: ${TAIL_MANY}`,
    );
  });

  it("accounts on different days are grouped by day in the one note, each day stated", () => {
    renderWith([A("Alpha", "2026-10-06"), A("Mid", "2026-10-08"), A("Zed", "2026-10-08")]);
    expect(screen.getByTestId(TID).textContent).toBe(
      "The total leaves out Alpha for Oct 6, 2026; Mid and Zed for Oct 8, 2026: " +
        "no BTC close is stored for those days yet, so they cannot be priced in USD.",
    );
  });

  // R2-WR-02: three kinds, three sentences. Each states only what its kind guarantees.
  describe("a whole-out account (the writer could not date it): the total leaves it out entirely", () => {
    it("one account: says it is out of the total, right now, with no date and no 'yet'", () => {
      renderWith([W("BTC desk")]);
      expect(screen.getByTestId(TID).textContent).toBe(
        "The total leaves out BTC desk entirely: it cannot be priced in USD right now.",
      );
    });

    it("several: joined by ' and ', plural, sorted by label", () => {
      renderWith([W("Zed"), W("Alpha"), W("Mid")]);
      expect(screen.getByTestId(TID).textContent).toBe(
        "The total leaves out Alpha, Mid and Zed entirely: they cannot be priced in USD right now.",
      );
    });

    it("after a dated sentence it reads 'also', so the two facts are not run together", () => {
      renderWith([W("Alpha"), A("Mid"), A("Zed")]);
      expect(screen.getByTestId(TID).textContent).toBe(
        `The total leaves out Mid and Zed for Oct 8, 2026: ${TAIL_MANY} ` +
          "The total also leaves out Alpha entirely: it cannot be priced in USD right now.",
      );
    });
  });

  describe("a history account (interior gaps only): the note is about the curve, never the total", () => {
    it("one account, several days: names the count against the equity history", () => {
      renderWith([H("BTC desk", 2)]);
      const text = screen.getByTestId(TID).textContent;
      expect(text).toBe(
        "The equity history leaves out BTC desk on 2 days: no BTC close is stored for those days, so it could not be priced in USD.",
      );
      // The account IS in the headline total: the sentence must not say otherwise.
      expect(text).not.toMatch(/The total/);
      expect(text).not.toMatch(/right now|yet/);
    });

    it("one day: singular", () => {
      renderWith([H("BTC desk", 1)]);
      expect(screen.getByTestId(TID).textContent).toBe(
        "The equity history leaves out BTC desk on 1 day: no BTC close is stored for that day, so it could not be priced in USD.",
      );
    });

    it("several accounts: each with its own count, plural tail", () => {
      renderWith([H("Zed", 3), H("Alpha", 1)]);
      expect(screen.getByTestId(TID).textContent).toBe(
        "The equity history leaves out Alpha on 1 day and Zed on 3 days: no BTC close is stored for those days, so they could not be priced in USD.",
      );
    });

    it("follows the total's sentences when both are present, and never merges into them", () => {
      renderWith([H("Alpha", 2), A("Mid"), W("Zed")]);
      expect(screen.getByTestId(TID).textContent).toBe(
        `The total leaves out Mid for Oct 8, 2026: ${TAIL_ONE} ` +
          "The total also leaves out Zed entirely: it cannot be priced in USD right now. " +
          "The equity history leaves out Alpha on 2 days: no BTC close is stored for those days, so it could not be priced in USD.",
      );
    });
  });

  it("is absent when nothing is omitted, when the prop is absent, and while the history is rebuilding", () => {
    renderWith([]);
    expect(screen.queryByTestId(TID)).toBeNull();
    cleanup();
    renderWith(undefined);
    expect(screen.queryByTestId(TID)).toBeNull();
    cleanup();
    renderWith([A("BTC desk")], "rebuilding");
    expect(screen.queryByTestId(TID)).toBeNull();
  });

  it("sits directly after the departed-history note and before the InsightStrip", () => {
    renderWith([A("BTC desk")], "ready", { departedHistoryUnavailable: true });
    const departed = screen.getByTestId("dashboard-departed-history-note");
    const note = screen.getByTestId(TID);
    const strip = screen.getByTestId("mock-insight-strip");
    expect(departed.nextElementSibling).toBe(note);
    expect(note.nextElementSibling).toBe(strip);
  });

  it("sits before the InsightStrip when there is no departed-history note", () => {
    renderWith([A("BTC desk")]);
    expect(screen.getByTestId(TID).nextElementSibling).toBe(screen.getByTestId("mock-insight-strip"));
  });

  it("prints a label as text, never as markup", () => {
    renderWith([A("<img src=x onerror=alert(1)>")]);
    const note = screen.getByTestId(TID);
    expect(note.querySelector("img")).toBeNull();
    expect(note.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
