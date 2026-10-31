import {
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
  vi,
  type MockInstance,
} from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * Phase 170.4 D-08 ("One Key is One Strategy"). Plan 07 made the payload one
 * row per key: two keys that each hold BTC are two rows, and their dollars sum.
 * The tables must keep them two rows too. Before this plan a row's id was the
 * venue:symbol:type ref alone, so the two BTC rows shared a React key and one
 * note-expansion state, and neither named the key it came from.
 *
 * Hand-typed fixture (no figure is computed by the code under test):
 *   key-a Binance "Main":  spot BTC 40000, BTC-PERP long  30000 notional, +1200 P&L
 *   key-b Binance "Hedge": spot BTC 25000, BTC-PERP short 10000 notional,  -300 P&L
 */

// The Optimizer mounts the shared PortfolioOptimizer via next/dynamic; no
// portfolios here, so it never mounts, but the stub keeps the import cheap.
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";

const spot = (api_key_id: string, value_usd: number) => ({
  symbol: "BTC",
  quantity: 1,
  mark_price_usd: value_usd,
  value_usd,
  venue: "binance",
  holding_type: "spot" as const,
  api_key_id,
  side: "flat" as const,
  entry_price: null,
  unrealized_pnl_usd: null,
});

const perp = (
  api_key_id: string,
  side: "long" | "short",
  value_usd: number,
  unrealized_pnl_usd: number,
) => ({
  symbol: "BTC-PERP",
  quantity: 1,
  mark_price_usd: 100,
  value_usd,
  venue: "binance",
  holding_type: "derivative" as const,
  api_key_id,
  side,
  entry_price: 90,
  unrealized_pnl_usd,
});

const KEYS = [
  { id: "key-a", sync_status: "complete", exchange: "binance", label: "Main" },
  { id: "key-b", sync_status: "complete", exchange: "binance", label: "Hedge" },
];

function payload(holdingsSummary: unknown[], apiKeys: unknown[] = KEYS) {
  return {
    portfolio: null,
    analytics: null,
    apiKeys,
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    holdingsSummary,
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
}

const TWO_KEY_BOOK = [
  spot("key-a", 40_000),
  spot("key-b", 25_000),
  perp("key-a", "long", 30_000, 1_200),
  perp("key-b", "short", 10_000, -300),
];

function renderPanel(book: unknown[], apiKeys?: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HoldingsTabPanel {...(payload(book, apiKeys) as any)} />);
}

function section(heading: string): HTMLElement {
  return screen
    .getByRole("heading", { name: heading })
    .closest("section") as HTMLElement;
}

function bodyRows(root: HTMLElement): HTMLElement[] {
  return within(root)
    .getAllByRole("row")
    .filter((r) => r.closest("tbody") !== null);
}

describe("HoldingsTabPanel, each key's position is its own named row (D-08)", () => {
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // HoldingNoteRow reads its note on mount; nothing is saved here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
  });
  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("shows two BTC rows on Holdings and two BTC-PERP rows on Open Positions, each captioned with its key", () => {
    renderPanel(TWO_KEY_BOOK);

    const holdings = bodyRows(section("Holdings"));
    expect(holdings).toHaveLength(2);
    const holdingCaptions = within(section("Holdings"))
      .getAllByTestId("holding-key-label")
      .map((el) => el.textContent);
    expect(holdingCaptions).toEqual(["Binance — Main", "Binance — Hedge"]);

    const positions = bodyRows(section("Open Positions"));
    expect(positions).toHaveLength(2);
    const positionCaptions = within(section("Open Positions"))
      .getAllByTestId("holding-key-label")
      .map((el) => el.textContent);
    expect(positionCaptions).toEqual(["Binance — Main", "Binance — Hedge"]);
  });

  it("gives the two keys' rows distinct React keys (no duplicate-key warning)", () => {
    renderPanel(TWO_KEY_BOOK);
    const duplicateKeyWarnings = errorSpy.mock.calls.filter((call) =>
      call.some(
        (arg: unknown) =>
          typeof arg === "string" &&
          arg.includes("children with the same key"),
      ),
    );
    expect(duplicateKeyWarnings).toEqual([]);
  });

  it("expands the note of one BTC row without expanding the other", () => {
    renderPanel(TWO_KEY_BOOK);
    const noteButtons = within(section("Holdings")).getAllByRole("button", {
      name: "Add note for BTC spot",
    });
    expect(noteButtons).toHaveLength(2);
    fireEvent.click(noteButtons[0]);
    expect(noteButtons[0].getAttribute("aria-expanded")).toBe("true");
    expect(noteButtons[1].getAttribute("aria-expanded")).toBe("false");
    // Exactly one note sub-row opened, directly under the clicked row.
    expect(document.querySelectorAll("[id^='note-row-']")).toHaveLength(1);
  });

  it("sums both keys' unrealized P&L in the Open Positions footer", () => {
    renderPanel(TWO_KEY_BOOK);
    // +1200 (key-a) and -300 (key-b) = +900.
    expect(
      within(section("Open Positions")).getByText("+$900.00"),
    ).toBeTruthy();
  });

  it("shows no caption, and never a raw key id, for a row whose key is not in the key list", () => {
    renderPanel(
      [spot("key-gone", 7_000), perp("key-gone", "long", 3_000, 50)],
      KEYS,
    );
    expect(bodyRows(section("Holdings"))).toHaveLength(1);
    expect(bodyRows(section("Open Positions"))).toHaveLength(1);
    expect(screen.queryAllByTestId("holding-key-label")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("key-gone");
  });
  // 167.1.1 D-02 (K1). A soft-disconnected key's dollars are disclosed exactly
  // like an untrusted key's: one chip, struck-through figures, filtered and
  // counted by the toggle. Fixture is hand-typed; key-a is disconnected, key-b
  // is a connected "complete" control in the same render.
  describe("167.1.1 D-02: a soft-disconnected key on the Holdings tab", () => {
    const DISCONNECTED_KEYS = [
      {
        id: "key-a",
        sync_status: "complete",
        exchange: "binance",
        label: "Main",
        disconnected_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "key-b",
        sync_status: "complete",
        exchange: "binance",
        label: "Hedge",
        disconnected_at: null,
      },
    ];
    const BOOK = [spot("key-a", 40_000), spot("key-b", 25_000)];

    it("chips the disconnected key's row once and strikes its figures; the connected row has neither", () => {
      renderPanel(BOOK, DISCONNECTED_KEYS);
      const [disconnectedRow, connectedRow] = bodyRows(section("Holdings"));
      expect(within(disconnectedRow).getAllByText("Key disconnected")).toHaveLength(1);
      expect(within(disconnectedRow).getByText("$40,000").className).toContain(
        "line-through",
      );
      expect(within(connectedRow).queryByText("Key disconnected")).toBeNull();
      expect(within(connectedRow).getByText("$25,000").className).not.toContain(
        "line-through",
      );
    });

    it("hides the disconnected row with the toggle off and counts it in the footer (singular)", () => {
      renderPanel(BOOK, DISCONNECTED_KEYS);
      fireEvent.click(
        screen.getByLabelText("Show holdings from keys needing attention"),
      );
      expect(bodyRows(section("Holdings"))).toHaveLength(1);
      expect(
        within(section("Holdings")).getByText(
          /1 holding hidden from keys needing attention/,
        ),
      ).toBeTruthy();
    });
  });
});
