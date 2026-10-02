/**
 * Phase 09 / Task 2 — HoldingFactsheet unit tests (finding g4).
 *
 * TDD RED phase: tests written before implementation.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoldingFactsheet } from "./HoldingFactsheet";
import type { HoldingCompareItem } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";

const SAMPLE: HoldingCompareItem = {
  kind: "holding",
  holding_ref: "holding:binance:BTC:spot",
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  historyState: "ready",
  analytics: {
    cumulative_return: 0.42,
    sharpe: 1.8,
    max_drawdown: -0.15,
    vol: 0.55,
  },
};

describe("HoldingFactsheet (finding g4)", () => {
  it("renders 'Holding' header badge", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.getByText(/Holding/i)).toBeInTheDocument();
  });

  it("renders ticker + venue + holding_type", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText(/binance/i)).toBeInTheDocument();
    expect(screen.getByText(/spot/i)).toBeInTheDocument();
  });

  it("renders all four computed metric labels", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    // Labels (DM Sans typography expected via DESIGN.md — tests validate presence not class)
    expect(screen.getByText(/cumulative|return/i)).toBeInTheDocument();
    expect(screen.getByText(/sharpe/i)).toBeInTheDocument();
    expect(screen.getByText(/drawdown/i)).toBeInTheDocument();
    expect(screen.getByText(/vol/i)).toBeInTheDocument();
  });

  it("renders em-dash for null metrics", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      historyState: "ready",
      analytics: {
        cumulative_return: null,
        sharpe: null,
        max_drawdown: null,
        vol: null,
      },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("exposes data-testid='holding-factsheet' on root", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.getByTestId("holding-factsheet")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Phase 167.1.2 / D-13 ("Hide it until correct", extended to /compare).
  //
  // Why this matters: the four metrics are level ratios over
  // allocator_equity_snapshots.breakdown, the store My Allocation now withholds
  // because it can count one exchange account twice and reads a purchase as a
  // gain. While the history is rebuilt the card shows an honest note and NO
  // metric: not the numbers, not em-dash placeholders that read as "no data".
  // SAMPLE ("ready", real numbers) above is the positive control.
  // -------------------------------------------------------------------------
  const REBUILDING: HoldingCompareItem = {
    kind: "holding",
    holding_ref: "holding:binance:BTC:spot",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    historyState: "rebuilding",
    analytics: null,
  };

  it("rebuilding: the note renders and no metric label or value does; the header stays", () => {
    render(<HoldingFactsheet item={REBUILDING} />);
    const note = screen.getByTestId("holding-factsheet-rebuilding");
    expect(note.textContent).toMatch(/hidden while your equity history is rebuilt/);
    expect(screen.queryByText("Cumulative return")).toBeNull();
    expect(screen.queryByText("Max drawdown")).toBeNull();
    expect(screen.queryByText("Vol (annualized)")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.getByText("BTC")).toBeInTheDocument();
  });

  it("ready: the four metrics render and the note does not (positive control)", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.queryByTestId("holding-factsheet-rebuilding")).toBeNull();
    expect(screen.getByText("42.00%")).toBeInTheDocument();
    expect(screen.getByText("1.80")).toBeInTheDocument();
  });

  // Fail-closed: a stale or hand-built item that carries numbers under any
  // state but an explicit "ready" still shows the note, never the numbers.
  it.each([
    ["rebuilding with numbers attached", "rebuilding"],
    ["an unrecognised state", "partial"],
    ["null", null],
  ])("historyState %s with analytics present → the note, not the numbers", (_label, state) => {
    const item = {
      ...SAMPLE,
      historyState: state,
    } as unknown as HoldingCompareItem;
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByTestId("holding-factsheet-rebuilding")).toBeInTheDocument();
    expect(screen.queryByText("42.00%")).toBeNull();
    expect(screen.queryByText("1.80")).toBeNull();
  });
});
