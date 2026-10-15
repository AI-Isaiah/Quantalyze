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
    priced_days: 40,
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
        priced_days: 12,
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
  // Phase 167.1.1 / D-03, UI-SPEC State R. The copy below is typed as literals
  // on purpose: it is the approved sentence, so a reworded caption fails here.
  // -------------------------------------------------------------------------
  it("State R: the caption names the priced-day count with a thousands separator", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...SAMPLE.analytics!, priced_days: 1234 },
    };
    render(<HoldingFactsheet item={item} />);
    const caption = screen.getByTestId("holding-factsheet-price-basis");
    expect(caption.textContent).toBe(
      "Computed from 1,234 days of BTC's daily price, so buying, selling or moving more of it does not count as a gain or loss.",
    );
    expect(caption.tagName).toBe("P");
    expect(caption.className).toBe("max-w-prose text-sm text-text-muted");
  });

  it("State R: a day count below the minimum is never described as 'Computed from' (SFH-02: priced_days decides, not the metrics)", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...SAMPLE.analytics!, priced_days: 1 },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toBe(
      "Only 1 priced day of BTC so far. These four figures need at least 30 priced days.",
    );
  });

  // State R0: too few priced days. The 30 is typed here on purpose, independent
  // of HOLDING_COMPARE_MIN_PRICED_DAYS, so moving the constant fails this arm.
  const NULL_METRICS = {
    cumulative_return: null,
    sharpe: null,
    max_drawdown: null,
    vol: null,
  };

  it("State R0: four em-dashes, never a 0, and the threshold caption at 29 priced days", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...NULL_METRICS, priced_days: 29 },
    };
    render(<HoldingFactsheet item={item} />);
    const dds = Array.from(
      screen.getByTestId("holding-factsheet").querySelectorAll("dd"),
    ).map((d) => d.textContent);
    expect(dds).toEqual(["—", "—", "—", "—"]);
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toBe(
      "Only 29 priced days of BTC so far. These four figures need at least 30 priced days.",
    );
    expect(screen.queryByText(/^Computed from/)).toBeNull();
  });

  it("State R0: one priced day reads '1 priced day'", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...NULL_METRICS, priced_days: 1 },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toBe(
      "Only 1 priced day of BTC so far. These four figures need at least 30 priced days.",
    );
  });

  it("State R0: zero priced days still renders the grid and the caption", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...NULL_METRICS, priced_days: 0 },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toBe(
      "Only 0 priced days of BTC so far. These four figures need at least 30 priced days.",
    );
  });

  it("a single null metric among finite ones keeps its em-dash and the State R caption", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: {
        cumulative_return: 0.42,
        sharpe: null,
        max_drawdown: -0.15,
        vol: null,
        priced_days: 40,
      },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByText("42.00%")).toBeInTheDocument();
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toMatch(
      /^Computed from 40 days of BTC's daily price/,
    );
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
    holding_ref: "holding:deribit:BTC-PERP:derivative",
    venue: "deribit",
    symbol: "BTC-PERP",
    holding_type: "derivative",
    historyState: "rebuilding",
    analytics: null,
  };

  it("State D: a derivative shows the corrected note and no metric label or value; the header stays", () => {
    render(<HoldingFactsheet item={REBUILDING} />);
    const note = screen.getByTestId("holding-factsheet-rebuilding");
    expect(note.textContent).toBe(
      "Return, Sharpe, max drawdown and volatility are not shown for derivative holdings yet. A price rise is a gain on a long position and a loss on a short one, and these figures wait until that direction is defined for each day.",
    );
    expect(note.textContent).not.toMatch(/rebuilt|double|twice/i);
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByTestId("holding-factsheet-price-basis")).toBeNull();
    expect(screen.queryByText("Cumulative return")).toBeNull();
    expect(screen.queryByText("Max drawdown")).toBeNull();
    expect(screen.queryByText("Vol (annualized)")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.getByText("BTC-PERP")).toBeInTheDocument();
  });

  // The gate that keeps State D closed: a derivative item that somehow carries
  // numbers under "rebuilding" must still show the note and no metric.
  it("State D is fail-closed: a derivative with analytics attached under 'rebuilding' shows the note, not the numbers", () => {
    // The union forbids this shape, so build it the way a stale item would arrive.
    const item = {
      ...REBUILDING,
      analytics: {
        cumulative_return: 0.42,
        sharpe: 1.8,
        max_drawdown: -0.15,
        vol: 0.55,
        priced_days: 40,
      },
    } as unknown as HoldingCompareItem;
    render(<HoldingFactsheet item={item} />);
    expect(
      screen.getByTestId("holding-factsheet-rebuilding").textContent,
    ).toMatch(/^Return, Sharpe, max drawdown and volatility are not shown for derivative holdings yet\./);
    expect(screen.queryByText("42.00%")).toBeNull();
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByTestId("holding-factsheet-price-basis")).toBeNull();
  });

  it("State X: a holding_type that is neither spot nor derivative fails closed to the spot-only sentence", () => {
    const item = {
      ...REBUILDING,
      holding_ref: "holding:binance:BTC:margin",
      venue: "binance",
      symbol: "BTC",
      holding_type: "margin",
    } as unknown as HoldingCompareItem;
    render(<HoldingFactsheet item={item} />);
    const note = screen.getByTestId("holding-factsheet-rebuilding");
    expect(note.textContent).toBe(
      "Return, Sharpe, max drawdown and volatility are computed for spot holdings only, and this holding is not recorded as spot.",
    );
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByTestId("holding-factsheet-price-basis")).toBeNull();
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

  // -------------------------------------------------------------------------
  // CR-01 / SFH-01 (167.1.1 round 1). A holding whose recorded price is a
  // writer constant (stablecoin, MT5 account, sFOX) shows no metric and says
  // why, by name. The sentence is typed as a literal on purpose: it is the
  // approved copy.
  // -------------------------------------------------------------------------
  const WITHHELD_FIXED: HoldingCompareItem = {
    kind: "holding",
    holding_ref: "holding:binance:USDT:spot",
    venue: "binance",
    symbol: "USDT",
    holding_type: "spot",
    historyState: "withheld",
    analytics: null,
    withheld_reason: "fixed_price",
  };

  it("State F: a fixed-price holding names its cause and shows no metric label, value, em-dash or basis line", () => {
    render(<HoldingFactsheet item={WITHHELD_FIXED} />);
    const note = screen.getByTestId("holding-factsheet-rebuilding");
    expect(note.textContent).toBe(
      "Return, Sharpe, max drawdown and volatility are not shown for USDT: its recorded price is a fixed value, not a market price.",
    );
    expect(note.tagName).toBe("P");
    expect(note.className).toBe("max-w-prose text-sm text-text-secondary");
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText("Cumulative return")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/0\.00%/)).toBeNull();
    expect(screen.queryByTestId("holding-factsheet-price-basis")).toBeNull();
    // The header stays, so the card is still identifiably that holding.
    expect(screen.getByText("USDT")).toBeInTheDocument();
    expect(screen.getByText(/binance/)).toBeInTheDocument();
  });

  // M-R2-01 (167.1.1 round 2): an MT5 account is an account balance. Its recorded
  // mark can be the unit's daily close (it varies), so "a fixed value" is false
  // for it. One sentence per cause, asserted verbatim.
  const WITHHELD_ACCOUNT: HoldingCompareItem = {
    kind: "holding",
    holding_ref: "holding:mt5:ACCOUNT-abc12345:spot",
    venue: "mt5",
    symbol: "ACCOUNT-abc12345",
    holding_type: "spot",
    historyState: "withheld",
    analytics: null,
    withheld_reason: "account_balance",
  };

  it("State F2: an MT5 account names itself and says it is an account balance, never a fixed value", () => {
    render(<HoldingFactsheet item={WITHHELD_ACCOUNT} />);
    const note = screen.getByTestId("holding-factsheet-rebuilding");
    expect(note.textContent).toBe(
      "Return, Sharpe, max drawdown and volatility are not shown for ACCOUNT-abc12345: it is an account balance, not a traded asset.",
    );
    expect(note.textContent).not.toMatch(/fixed value/);
    expect(note.tagName).toBe("P");
    expect(note.className).toBe("max-w-prose text-sm text-text-secondary");
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByTestId("holding-factsheet-price-basis")).toBeNull();
  });

  // M-R2-02 (167.1.1 round 2): a crypto holding with rows and no priced day.
  const WITHHELD_NO_PRICE: HoldingCompareItem = {
    kind: "holding",
    holding_ref: "holding:binance:LDBTC:spot",
    venue: "binance",
    symbol: "LDBTC",
    holding_type: "spot",
    historyState: "withheld",
    analytics: null,
    withheld_reason: "no_price",
  };

  it("State N: a holding with no recorded market price says so, and promises no wait ('yet', 'so far')", () => {
    render(<HoldingFactsheet item={WITHHELD_NO_PRICE} />);
    const note = screen.getByTestId("holding-factsheet-rebuilding");
    expect(note.textContent).toBe(
      "Return, Sharpe, max drawdown and volatility are not shown for LDBTC: no market price has been recorded for it.",
    );
    expect(note.tagName).toBe("P");
    expect(note.className).toBe("max-w-prose text-sm text-text-secondary");
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByTestId("holding-factsheet-price-basis")).toBeNull();
    expect(note.textContent).not.toMatch(/\byet\b|so far|fixed value|account balance/);
  });

  it("each withheld reason renders its own sentence, and the two never cross", () => {
    const { rerender } = render(<HoldingFactsheet item={WITHHELD_FIXED} />);
    expect(screen.getByTestId("holding-factsheet-rebuilding").textContent).toMatch(
      /its recorded price is a fixed value, not a market price\.$/,
    );
    expect(screen.getByTestId("holding-factsheet-rebuilding").textContent).not.toMatch(/account balance/);
    rerender(<HoldingFactsheet item={WITHHELD_ACCOUNT} />);
    expect(screen.getByTestId("holding-factsheet-rebuilding").textContent).toMatch(
      /it is an account balance, not a traded asset\.$/,
    );
    expect(screen.getByTestId("holding-factsheet-rebuilding").textContent).not.toMatch(/fixed value/);
  });

  it("State F is fail-closed: a withheld item with analytics smuggled in still shows the note, not the numbers", () => {
    const item = {
      ...WITHHELD_FIXED,
      analytics: { cumulative_return: 0, sharpe: null, max_drawdown: 0, vol: 0, priced_days: 40 },
    } as unknown as HoldingCompareItem;
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByTestId("holding-factsheet-rebuilding").textContent).toMatch(
      /^Return, Sharpe, max drawdown and volatility are not shown for USDT: its recorded price/,
    );
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText(/0\.00%/)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // SFH-02 (167.1.1 round 1). Two sources of truth used to decide "too few
  // priced days": the component inferred it from "all four metrics null", while
  // the adapter's rule is priced_days < MIN. And a holding with >= MIN priced
  // days that are NOT on consecutive calendar days has numeric return and
  // drawdown but null vol and Sharpe, with no reason on the card.
  // -------------------------------------------------------------------------
  const GAPPY = {
    cumulative_return: 0.12,
    sharpe: null,
    max_drawdown: -0.04,
    vol: null,
  };
  const ADJACENCY_NOTE =
    "Volatility and Sharpe need at least two pairs of consecutive priced days.";

  it("State R0 is decided by priced_days < the minimum, not by 'all four null': 29 days with numeric return still reads 'Only 29'", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...GAPPY, priced_days: 29 },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toBe(
      "Only 29 priced days of BTC so far. These four figures need at least 30 priced days.",
    );
    expect(screen.queryByText(/^Computed from/)).toBeNull();
    // Below the minimum the threshold sentence is the whole explanation.
    expect(screen.queryByTestId("holding-factsheet-adjacency-note")).toBeNull();
  });

  it("State R0 does not fire at the minimum even when every metric is null: 30 days is State R", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...NULL_METRICS, priced_days: 30 },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toMatch(
      /^Computed from 30 days of BTC's daily price/,
    );
  });

  it("State R with null vol and Sharpe: one muted sentence names why, beside numeric return and drawdown", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { ...GAPPY, priced_days: 40 },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.getByText("12.00%")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    const note = screen.getByTestId("holding-factsheet-adjacency-note");
    expect(note.textContent).toBe(ADJACENCY_NOTE);
    expect(note.tagName).toBe("P");
    expect(note.className).toBe("max-w-prose text-sm text-text-muted");
    // The State R basis caption is unchanged.
    expect(screen.getByTestId("holding-factsheet-price-basis").textContent).toMatch(
      /^Computed from 40 days of BTC's daily price/,
    );
  });

  it("the sentence is absent when vol is a number (a null Sharpe alone is not an adjacency problem)", () => {
    const item: HoldingCompareItem = {
      ...SAMPLE,
      analytics: { cumulative_return: 0, sharpe: null, max_drawdown: 0, vol: 0, priced_days: 40 },
    };
    render(<HoldingFactsheet item={item} />);
    expect(screen.queryByTestId("holding-factsheet-adjacency-note")).toBeNull();
  });

  it("the sentence is absent in State R when every metric is a number (positive control)", () => {
    render(<HoldingFactsheet item={SAMPLE} />);
    expect(screen.queryByTestId("holding-factsheet-adjacency-note")).toBeNull();
  });

  it("lets an unbroken symbol wrap inside the card instead of pushing past it at 375px", () => {
    // Measured 2026-10-15 at 375x812 on the local stack: an MT5 `ACCOUNT-<48 hex>`
    // heading ran 160 px past its card. jsdom cannot measure layout, so this pins
    // the two properties the fix rests on: the card wraps anywhere (inherited by
    // the heading and every note) and neither flex level can grow past its track.
    render(<HoldingFactsheet item={{ ...SAMPLE, symbol: `ACCOUNT-${"a".repeat(48)}` }} />);
    const card = screen.getByTestId("holding-factsheet");
    expect(card.className).toContain("[overflow-wrap:anywhere]");
    expect(card.className).toContain("min-w-0");
    expect(screen.getByRole("heading", { level: 3 }).parentElement?.className).toContain("min-w-0");
  });
});
