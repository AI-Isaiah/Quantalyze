import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * Phase 170.4 D-02. A book whose only positions are open derivatives used to
 * read "No holdings to display." directly above a table of open positions, which
 * says the book is empty when it is not. The Holdings table now says it holds no
 * SPOT holdings and points at the Open Positions table below, using that
 * table's own row count (HoldingsTabPanel passes `openPositionRows.length`).
 *
 * The honest empty line is kept for a truly empty book, and for a book whose
 * spot rows are all hidden by the untrusted-key filter: "No spot holdings" would
 * be false of hidden spot rows, so that case keeps today's line and footer.
 */

// The panel mounts the shared optimizer via next/dynamic (it calls useRouter);
// no portfolios here, so it never mounts, but a marker keeps the import cheap.
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { HoldingsTabPanel } from "../HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "../lib/exposure-props";

const EMPTY_LINE = "No holdings to display.";
const NO_SPOT_LINE = "No spot holdings.";

function spotRow(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "binance:BTC:spot#key-a",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    quantity: 1,
    value_usd: 60_000,
    entry_price: null,
    unrealized_pnl_usd: null,
    api_key_id: "key-a",
    source_key_sync_status: "complete",
    source_key_disconnected_at: null,
    ...overrides,
  };
}

describe("HoldingsTable empty line, derivatives-only book (D-02)", () => {
  it("names the 3 open positions below and never says the book is empty", () => {
    render(<HoldingsTable holdings={[]} openPositionCount={3} />);
    expect(screen.getByText(NO_SPOT_LINE)).toBeTruthy();
    expect(
      screen.getByText(
        "Your 3 open positions are listed under Open Positions below.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(EMPTY_LINE)).toBeNull();
  });

  it("words one open position in the singular", () => {
    render(<HoldingsTable holdings={[]} openPositionCount={1} />);
    expect(screen.getByText(NO_SPOT_LINE)).toBeTruthy();
    expect(
      screen.getByText(
        "Your 1 open position is listed under Open Positions below.",
      ),
    ).toBeTruthy();
  });

  it.each([[0], [undefined]])(
    "keeps the honest empty line byte-for-byte when the count is %s",
    (count) => {
      render(<HoldingsTable holdings={[]} openPositionCount={count} />);
      expect(screen.getByText(EMPTY_LINE)).toBeTruthy();
      expect(screen.queryByText(NO_SPOT_LINE)).toBeNull();
    },
  );

  it("keeps today's line and hidden-count footer when the only spot row is hidden by the untrusted-key filter", () => {
    render(
      <HoldingsTable
        holdings={[spotRow({ source_key_sync_status: "revoked" })]}
        showRevoked={false}
        onShowRevokedChange={() => {}}
        openPositionCount={3}
      />,
    );
    // A hidden spot row IS a spot holding: "No spot holdings" would be false.
    expect(screen.getByText(EMPTY_LINE)).toBeTruthy();
    expect(screen.queryByText(NO_SPOT_LINE)).toBeNull();
    expect(screen.getByText(/1 holding hidden from/)).toBeTruthy();
  });
});

const derivative = (
  api_key_id: string,
  symbol: string,
  side: "long" | "short",
  value_usd: number,
) => ({
  symbol,
  quantity: 1,
  mark_price_usd: 100,
  value_usd,
  venue: "deribit",
  holding_type: "derivative" as const,
  api_key_id,
  side,
  entry_price: 90,
  unrealized_pnl_usd: 10,
});

describe("HoldingsTabPanel, a book with only open positions (D-02)", () => {
  it("states the Open Positions table's own row count in the Holdings table", () => {
    const payload = {
      portfolio: null,
      analytics: null,
      apiKeys: [
        {
          id: "key-a",
          sync_status: "complete",
          exchange: "deribit",
          label: "Main",
        },
      ],
      alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      outcomes: [],
      holdingsSummary: [
        derivative("key-a", "BTC-PERP", "long", 30_000),
        derivative("key-a", "ETH-PERP", "short", 12_000),
        derivative("key-a", "SOL-PERP", "long", 4_000),
      ],
      snapshotCount: 30,
      allKeysStale: false,
      lastSyncAt: null,
      hasSyncing: false,
      equityDailyPoints: [],
      activeVenues: [],
      flaggedHoldings: [],
      matchDecisionsByHoldingRef: {},
      strategies: [],
      exposure: EMPTY_EXPOSURE,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<HoldingsTabPanel {...(payload as any)} />);

    const holdingsSection = screen
      .getByRole("heading", { name: "Holdings" })
      .closest("section") as HTMLElement;
    expect(within(holdingsSection).getByText(NO_SPOT_LINE)).toBeTruthy();
    expect(
      within(holdingsSection).getByText(
        "Your 3 open positions are listed under Open Positions below.",
      ),
    ).toBeTruthy();
    expect(within(holdingsSection).queryByText(EMPTY_LINE)).toBeNull();

    // The sentence and the table below cannot disagree: three position rows.
    const positionsSection = screen
      .getByRole("heading", { name: "Open Positions" })
      .closest("section") as HTMLElement;
    const bodyRows = within(positionsSection)
      .getAllByRole("row")
      .filter((r) => r.closest("tbody") !== null);
    expect(bodyRows).toHaveLength(3);
  });
});
