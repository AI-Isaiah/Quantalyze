import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// queries.ts is server-only; the SFH-01 test reads its `emptyLiveBaselineMetrics`
// builder only, so the guard is replaced with an empty module.
vi.mock("server-only", () => ({}));

import { AllocationDashboardV2 } from "../AllocationDashboardV2";
import { BOOK_FIGURES_SERIES_CAPTION, liveBookFigures } from "../lib/book-figures";
import { withheldCellTitle, shortTrackMarkerTitle } from "@/lib/figure-gate";
import { emptyLiveBaselineMetrics } from "@/lib/queries";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 198 plan 01 (D-06, ROUTE-07, SC-2, research C5-C7). The Overview opens
// with one at-a-glance panel: return, risk and holdings, read from the shared
// figures module that Scenario's live strip also reads. The heavy Overview
// children are mocked the way AllocationDashboardV2.failing-key.test.tsx does.
// ---------------------------------------------------------------------------

vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="mock-insight-strip" />,
}));
vi.mock("./AlertBanner", () => ({
  AlertBanner: () => <div data-testid="mock-alert-banner" />,
}));
vi.mock("../widgets/performance/EquityChart", () => ({
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

type Holding = MyAllocationDashboardPayload["holdingsSummary"][number];

const spot = (value: number, over: Partial<Holding> = {}): Holding =>
  ({
    symbol: "BTC",
    quantity: 1,
    mark_price_usd: value,
    value_usd: value,
    venue: "okx",
    holding_type: "spot",
    api_key_id: "k1",
    side: null,
    entry_price: null,
    unrealized_pnl_usd: null,
    ...over,
  }) as Holding;

const deriv = (pnl: number | null, over: Partial<Holding> = {}): Holding =>
  ({
    symbol: "BTC-PERP",
    quantity: 1,
    mark_price_usd: 50_000,
    value_usd: 50_000,
    venue: "okx",
    holding_type: "derivative",
    api_key_id: "k1",
    side: "long",
    entry_price: 49_000,
    unrealized_pnl_usd: pnl,
    ...over,
  }) as Holding;

/** `days` consecutive daily points ending on `end`: they cover exactly `days` days. */
function equityEnding(end: string, days: number) {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(endMs - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    value: 1 + i * 0.001,
  }));
}

function baseline(days: number, over: Record<string, unknown> = {}) {
  return {
    aum: 999_999_999, // a trap: Book equity must never read this (C5)
    ytdTwr: 0.0421,
    sharpe: 1.37,
    maxDd: -0.068,
    avgRho: 0.2,
    equity: equityEnding("2026-11-06", days),
    drawdown: [],
    ...over,
  };
}

function payload(
  over: Partial<MyAllocationDashboardPayload> = {},
): MyAllocationDashboardPayload {
  return {
    portfolio: {
      id: "p1",
      user_id: "u1",
      name: "Test Portfolio",
      description: null,
      created_at: "2023-01-01T00:00:00Z",
      is_test: false,
    },
    strategies: [],
    analytics: { total_aum: 100_000 } as never,
    apiKeys: [] as never,
    holdingsSummary: [spot(50_000), spot(2_000, { symbol: "ETH" })],
    flaggedHoldings: [],
    equityDailyPoints: [],
    activeVenues: [],
    snapshotCount: 0,
    allocator_id: "alloc-1",
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    allKeysStale: false,
    lastSyncAt: "2026-05-28T11:00:00Z",
    hasSyncing: false,
    hasConnectedKeys: true,
    equityHistoryState: "ready",
    liveBaselineMetrics: baseline(400),
    ...over,
  } as unknown as MyAllocationDashboardPayload;
}

function glance() {
  return screen.getByRole("region", { name: "Book at a glance" });
}

describe("GlancePanel on the Overview (198 plan 01)", () => {
  afterEach(() => cleanup());

  it("a ready payload with a 400-day record prints the live-book figures and the holdings figures", () => {
    render(<AllocationDashboardV2 {...payload()} />);
    expect(screen.getByTestId("glance-ytd").textContent).toBe("+4.21%");
    expect(screen.getByTestId("glance-sharpe").textContent).toBe("1.37");
    expect(screen.getByTestId("glance-maxdd").textContent).toBe("-6.80%");
    // C5: the sum of the rows (50,000 + 2,000), never the baseline's `aum`.
    expect(screen.getByTestId("glance-book-equity").textContent).toBe(
      "$52,000",
    );
    expect(screen.getByTestId("glance-positions").textContent).toBe("2");
    expect(screen.getByTestId("glance-ytd").className).toContain(
      "text-positive",
    );
    expect(screen.getByTestId("glance-maxdd").className).toContain(
      "text-negative",
    );
  });

  it("Book equity is spot value plus each derivative's reported P&L, and Positions counts every row", () => {
    render(
      <AllocationDashboardV2
        {...payload({
          holdingsSummary: [spot(10_000), deriv(1_500), deriv(-500)],
        })}
      />,
    );
    expect(screen.getByTestId("glance-book-equity").textContent).toBe(
      "$11,000",
    );
    expect(screen.getByTestId("glance-positions").textContent).toBe("3");
  });

  it("Positions prints thousands separators", () => {
    const rows = Array.from({ length: 1234 }, (_, i) =>
      spot(1, { symbol: `S${i}` }),
    );
    render(<AllocationDashboardV2 {...payload({ holdingsSummary: rows })} />);
    expect(screen.getByTestId("glance-positions").textContent).toBe("1,234");
  });

  it("a 60-day record withholds Sharpe: a toneless dash, the 194 reason in title and sr-only text", () => {
    render(
      <AllocationDashboardV2 {...payload({ liveBaselineMetrics: baseline(60) })} />,
    );
    const cell = screen.getByTestId("glance-sharpe");
    const reason = withheldCellTitle(
      liveBookFigures(baseline(60) as never).sharpeRecord,
    );
    expect(cell.querySelector("[title]")?.getAttribute("title")).toBe(reason);
    expect(cell.querySelector(".sr-only")?.textContent).toBe(reason);
    expect(cell.textContent).not.toContain("1.37");
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
    // The other two risk and return cells are judged by nothing: they stay.
    expect(screen.getByTestId("glance-ytd").textContent).toBe("+4.21%");
  });

  it("a 200-day record shows Sharpe with the under-one-year marker", () => {
    render(
      <AllocationDashboardV2
        {...payload({ liveBaselineMetrics: baseline(200) })}
      />,
    );
    const cell = screen.getByTestId("glance-sharpe");
    expect(cell.textContent).toContain("1.37");
    expect(cell.textContent).toContain("<1y");
    expect(cell.querySelector("[title]")?.getAttribute("title")).toBe(
      shortTrackMarkerTitle(200),
    );
  });

  it("C7: a rebuilding history still prints Return and Risk when the live figures exist", () => {
    render(
      <AllocationDashboardV2
        {...payload({ equityHistoryState: "rebuilding" })}
      />,
    );
    expect(screen.getByTestId("glance-ytd").textContent).toBe("+4.21%");
    expect(screen.getByTestId("glance-sharpe").textContent).toBe("1.37");
    expect(screen.getByTestId("glance-maxdd").textContent).toBe("-6.80%");
    expect(screen.getByTestId("glance-book-equity").textContent).toBe(
      "$52,000",
    );
  });

  it("allKeysStale collapses the three return and risk cells to a dash and keeps Holdings", () => {
    render(<AllocationDashboardV2 {...payload({ allKeysStale: true })} />);
    expect(screen.getByTestId("glance-ytd").textContent).toBe("—");
    expect(screen.getByTestId("glance-sharpe").textContent).toBe("—");
    expect(screen.getByTestId("glance-maxdd").textContent).toBe("—");
    expect(screen.getByTestId("glance-book-equity").textContent).toBe(
      "$52,000",
    );
    expect(screen.getByTestId("glance-positions").textContent).toBe("2");
  });

  it("Book equity is a dash, not $0, when every row is a derivative with no reported P&L", () => {
    render(
      <AllocationDashboardV2
        {...payload({ holdingsSummary: [deriv(null), deriv(null)] })}
      />,
    );
    expect(screen.getByTestId("glance-book-equity").textContent).toContain("—");
    expect(screen.getByTestId("glance-book-equity").textContent).not.toContain("$0");
  });

  it("derivatives with no reported P&L are excluded from Book equity and counted in a caption", () => {
    const two = payload({
      holdingsSummary: [spot(1_000), deriv(null), deriv(null)],
    });
    render(<AllocationDashboardV2 {...two} />);
    expect(screen.getByTestId("glance-book-equity").textContent).toBe("$1,000");
    expect(glance().textContent).toContain(
      "Excludes 2 derivative positions with no reported P&L.",
    );
    cleanup();
    render(
      <AllocationDashboardV2
        {...payload({ holdingsSummary: [spot(1_000), deriv(null)] })}
      />,
    );
    expect(glance().textContent).toContain(
      "Excludes 1 derivative position with no reported P&L.",
    );
    cleanup();
    render(<AllocationDashboardV2 {...payload()} />);
    expect(glance().textContent).not.toContain("Excludes");
  });

  it("the empty-book connect card replaces everything: no glance region", () => {
    render(
      <AllocationDashboardV2
        {...payload({ holdingsSummary: [], hasConnectedKeys: false })}
      />,
    );
    expect(screen.queryByRole("region", { name: "Book at a glance" })).toBeNull();
    expect(screen.queryByTestId("glance-ytd")).toBeNull();
  });

  it("the stamp names the series' last day and the newest holdings read, from the payload and never a clock", () => {
    render(
      <AllocationDashboardV2
        {...payload({
          holdingsSummary: [
            spot(1, { asof: "2026-11-05" }),
            spot(1, { symbol: "ETH", asof: "2026-11-07" }),
          ],
        })}
      />,
    );
    expect(glance().textContent).toContain(
      "Figures through Nov 6, 2026 · holdings read Nov 7, 2026",
    );
  });

  it("with no asof on any row only the first half of the stamp renders", () => {
    render(<AllocationDashboardV2 {...payload()} />);
    expect(glance().textContent).toContain("Figures through Nov 6, 2026");
    expect(glance().textContent).not.toContain("holdings read");
  });

  it("D-06: the ready glance labels its YTD figure `YTD TWR` and names the series it is blended from", () => {
    render(<AllocationDashboardV2 {...payload()} />);
    expect(within(glance()).getByText("YTD TWR")).toBeInTheDocument();
    expect(within(glance()).getByText(BOOK_FIGURES_SERIES_CAPTION)).toBeInTheDocument();
    expect(BOOK_FIGURES_SERIES_CAPTION).toBe(
      "Return and risk: live book, blended from each key's daily returns.",
    );
  });

  it("a missing live baseline prints dashes for return and risk and never throws", () => {
    render(
      <AllocationDashboardV2
        {...payload({ liveBaselineMetrics: undefined as never })}
      />,
    );
    expect(screen.getByTestId("glance-ytd").textContent).toBe("—");
    expect(screen.getByTestId("glance-sharpe").textContent).toBe("—");
    expect(screen.getByTestId("glance-book-equity").textContent).toBe(
      "$52,000",
    );
  });

  it("stacks on its own container's width, never a viewport breakpoint (E2)", () => {
    render(<AllocationDashboardV2 {...payload()} />);
    const html = glance().outerHTML;
    expect(html).toContain("@container");
    expect(html).toContain("@lg:grid-cols-3");
    expect(html).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols/);
  });
});

// ---------------------------------------------------------------------------
// Gap 198-UAT-01 (D-10, research C7, D-06). Rule 9: in the 2026-11-09 browser
// UAT the founder read a glance printing YTD TWR, Sharpe and Max DD, and
// directly under it a note saying those figures were not shown. The glance's
// figures come from the live per-key baseline, which the history state does not
// withhold, so a book-level line may only name what the withheld history hides:
// the equity chart and the ratios built from it. This agreement test renders
// the full Overview for every rebuild reason with live figures, because a
// per-component pin cannot see the two surfaces disagree.
// ---------------------------------------------------------------------------

describe("198-UAT-01: the glance and the missing-data note agree on a rebuilding Overview", () => {
  afterEach(() => cleanup());

  const REASONS = [
    "duplicate_account",
    "key_not_syncing",
    "shared_account_no_working_key",
    "history_read_failed",
    "account_identity_pending",
    "awaiting_derivation",
    "derivation_rejected",
    "shared_account_history_truncated",
    null,
  ] as const;

  // 198-14 SFH-02: the claim is "the note says return or risk is missing", so the
  // check matches the singular and the plural. The one legitimate use of the word
  // is awaiting_derivation's description of the daily run ("each account's returns
  // and cash flows"), which is stripped first.
  const namesReturnOrRisk = (text: string) =>
    /\b(returns?|risks?)\b/i.test(
      text.replace("each account's returns and cash flows", ""),
    );

  // The reasons whose book-level line names what the history hides.
  const NAMES_THE_HIDDEN_HISTORY = new Set<string | null>([
    "awaiting_derivation",
    "derivation_rejected",
    null,
  ]);

  it.each(REASONS)(
    "reason %s: the glance prints its live values and the note names neither return nor risk",
    (reason) => {
      render(
        <AllocationDashboardV2
          {...payload({
            equityHistoryState: "rebuilding",
            equityHistoryRebuildReason: reason,
          })}
        />,
      );
      expect(screen.getByTestId("glance-ytd").textContent).toBe("+4.21%");
      expect(screen.getByTestId("glance-sharpe").textContent).toBe("1.37");
      expect(screen.getByTestId("glance-maxdd").textContent).toBe("-6.80%");

      const note = screen.getByTestId("overview-missing-data");
      expect(namesReturnOrRisk(note.textContent!)).toBe(false);
      expect(document.body.textContent).not.toMatch(/note below/i);
      // The glance's Risk group prints Sharpe and Max DD without the history
      // (C7), so the Risk section may not claim those figures depend on it.
      const riskLine = document.querySelector("#risk p");
      expect(riskLine, "the Risk section's not-ready line").not.toBeNull();
      expect(namesReturnOrRisk(riskLine!.textContent!)).toBe(false);
      expect(riskLine!.textContent).toContain("See the note above.");
      if (NAMES_THE_HIDDEN_HISTORY.has(reason)) {
        expect(note.textContent!.toLowerCase()).toContain(
          "the equity chart and the ratios built from it",
        );
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 198-14 SFH-01. The no-live-series state (key_not_syncing, account_identity_pending,
// awaiting_derivation, history_read_failed) prints every Return and Risk cell as a
// dash, and the note below is the only explanation. So that state, and only that
// state, carries the sr-only pointer. A cell that prints a value never does (the
// 198-UAT-01 contradiction), and a withheld Sharpe carries its own reason.
// ---------------------------------------------------------------------------

describe("198-14 SFH-01: the sr-only pointer is narrow", () => {
  afterEach(() => cleanup());

  const POINTER = "No live figures yet. See the note below.";
  const CELLS = ["glance-ytd", "glance-sharpe", "glance-maxdd"] as const;

  it("with the empty live baseline and a rebuilding reason, each Return and Risk dash points at the note", () => {
    render(
      <AllocationDashboardV2
        {...payload({
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: "key_not_syncing",
          liveBaselineMetrics: emptyLiveBaselineMetrics([]),
        })}
      />,
    );
    expect(screen.getByTestId("overview-missing-data")).toBeInTheDocument();
    for (const id of CELLS) {
      const cell = screen.getByTestId(id);
      expect(cell.textContent, id).toBe(`—${POINTER}`);
      expect(cell.querySelector(".sr-only")?.textContent, id).toBe(POINTER);
    }
    // Holdings cells are not Return or Risk cells and carry no pointer.
    expect(screen.getByTestId("glance-positions").textContent).not.toContain(
      POINTER,
    );
  });

  it("the all-keys-stale dashes carry no pointer: the staleness banner explains them", () => {
    render(
      <AllocationDashboardV2
        {...payload({
          allKeysStale: true,
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: "key_not_syncing",
          liveBaselineMetrics: emptyLiveBaselineMetrics([]),
        })}
      />,
    );
    for (const id of CELLS) {
      expect(screen.getByTestId(id).textContent, id).toBe("—");
    }
  });

  it("a cell that prints a value never carries the pointer, even with a note below", () => {
    render(
      <AllocationDashboardV2
        {...payload({
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: "key_not_syncing",
        })}
      />,
    );
    expect(screen.getByTestId("overview-missing-data")).toBeInTheDocument();
    expect(glance().textContent).not.toContain(POINTER);
    expect(screen.getByTestId("glance-ytd").textContent).toBe("+4.21%");
  });

  it("a withheld Sharpe carries its own reason, never the pointer", () => {
    render(
      <AllocationDashboardV2
        {...payload({
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: "key_not_syncing",
          liveBaselineMetrics: baseline(60),
        })}
      />,
    );
    const cell = screen.getByTestId("glance-sharpe");
    expect(cell.textContent).not.toContain(POINTER);
    expect(cell.querySelector(".sr-only")?.textContent).toBe(
      withheldCellTitle(liveBookFigures(baseline(60) as never).sharpeRecord),
    );
  });

  it("a ready book with no live baseline renders no note and no pointer", () => {
    render(
      <AllocationDashboardV2
        {...payload({ liveBaselineMetrics: emptyLiveBaselineMetrics([]) })}
      />,
    );
    expect(screen.queryByTestId("overview-missing-data")).toBeNull();
    expect(glance().textContent).not.toContain(POINTER);
  });
});
