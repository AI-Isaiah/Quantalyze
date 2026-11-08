import { describe, it, expect } from "vitest";
import {
  bookEquityUsd,
  holdingsReadDay,
  liveBookFigures,
  unreportedDerivativeCaption,
  unreportedDerivativeCount,
} from "./book-figures";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// Phase 198 plan 01 (D-06, research C5-C7): the shared figures module. The
// 194 D-15 boundary for the live record (a crypto record: 90 covered days
// clears) and the Book equity rule (C5: every row, never the baseline AUM).

type Baseline = MyAllocationDashboardPayload["liveBaselineMetrics"];
type Holding = MyAllocationDashboardPayload["holdingsSummary"][number];

/** `days` consecutive daily points: they cover exactly `days` days (D-20). */
function equity(days: number): Baseline["equity"] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: 1 + i * 0.001,
  }));
}

const baseline = (days: number, over: Partial<Baseline> = {}): Baseline => ({
  aum: 123_456,
  ytdTwr: 0.04,
  sharpe: 1.37,
  maxDd: -0.07,
  avgRho: 0.1,
  equity: equity(days),
  drawdown: [],
  ...over,
});

const spot = (value: number): Holding =>
  ({ holding_type: "spot", value_usd: value, unrealized_pnl_usd: null }) as Holding;
const deriv = (pnl: number | null): Holding =>
  ({ holding_type: "derivative", value_usd: 99_999, unrealized_pnl_usd: pnl }) as Holding;

describe("liveBookFigures: the 194 D-15 gate on the live baseline's own record", () => {
  it.each([
    [89, "withheld", null],
    [90, "short", 1.37],
    [365, "full", 1.37],
  ])("a %s-day record is %s", (days, state, sharpe) => {
    const f = liveBookFigures(baseline(days));
    expect(f.sharpeState).toBe(state);
    expect(f.sharpe).toBe(sharpe);
  });

  it("an empty equity gives state null and leaves a non-null Sharpe alone (D-17: unknown is not withheld)", () => {
    const f = liveBookFigures(baseline(0));
    expect(f.sharpeState).toBe("null");
    expect(f.sharpe).toBe(1.37);
    expect(f.seriesEndDay).toBeNull();
  });

  it("the record is a crypto record: 365 periods a year, observations one fewer than the points", () => {
    const f = liveBookFigures(baseline(100));
    expect(f.sharpeRecord.crypto).toBe(true);
    expect(f.sharpeRecord.observations).toBe(99);
    expect(f.sharpeRecord.spanDays).toBe(100);
  });

  it("return and risk do not depend on anything but the baseline (C7), and the series end is the last equity date", () => {
    const f = liveBookFigures(baseline(100));
    expect(f.ytdTwr).toBe(0.04);
    expect(f.maxDd).toBe(-0.07);
    expect(f.seriesEndDay).toBe(equity(100)[99].date);
  });

  it("tolerates a null or absent baseline", () => {
    for (const b of [null, undefined]) {
      const f = liveBookFigures(b);
      expect(f.ytdTwr).toBeNull();
      expect(f.sharpe).toBeNull();
      expect(f.maxDd).toBeNull();
      expect(f.seriesEndDay).toBeNull();
    }
  });
});

describe("bookEquityUsd (C5)", () => {
  it("is null for an empty list, never a zero", () => {
    expect(bookEquityUsd([])).toBeNull();
  });

  it("spot rows contribute value_usd; a derivative contributes its P&L, never its notional", () => {
    expect(bookEquityUsd([spot(1_000), spot(250), deriv(300), deriv(-100)])).toBe(1_450);
  });

  it("a derivative with no reported P&L adds nothing and is counted", () => {
    const rows = [spot(1_000), deriv(null), deriv(null), deriv(5)];
    expect(bookEquityUsd(rows)).toBe(1_005);
    expect(unreportedDerivativeCount(rows)).toBe(2);
    expect(unreportedDerivativeCount([spot(1)])).toBe(0);
  });

  it("is null, not zero, when holdings exist but no row reports a contribution", () => {
    // Why: the glance prints formatUsd(equity); a 0 here reads as "$0" for a
    // book that is merely unreported. Unknown is null and renders as a dash.
    expect(bookEquityUsd([deriv(null), deriv(null)])).toBeNull();
  });

  it("a reported zero is still a zero", () => {
    expect(bookEquityUsd([deriv(0)])).toBe(0);
  });
});

describe("holdingsReadDay", () => {
  it("returns the newest asof and ignores rows without one", () => {
    const rows = [
      { asof: "2026-11-05" },
      {},
      { asof: "2026-11-07" },
      { asof: "2026-11-06" },
    ] as Holding[];
    expect(holdingsReadDay(rows)).toBe("2026-11-07");
  });

  it("is null when no row carries one", () => {
    expect(holdingsReadDay([{} as Holding])).toBeNull();
    expect(holdingsReadDay([])).toBeNull();
  });
});

describe("unreportedDerivativeCaption", () => {
  // Plan 198-11: the glance and the Positions header print this one sentence.
  it("is null for none, singular for one, plural otherwise", () => {
    expect(unreportedDerivativeCaption(0)).toBeNull();
    expect(unreportedDerivativeCaption(1)).toBe(
      "Excludes 1 derivative position with no reported P&L.",
    );
    expect(unreportedDerivativeCaption(2)).toBe(
      "Excludes 2 derivative positions with no reported P&L.",
    );
  });
});
