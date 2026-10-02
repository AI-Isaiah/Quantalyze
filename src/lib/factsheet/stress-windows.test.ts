import { describe, it, expect } from "vitest";
import { computeStressWindows } from "./stress-windows";

describe("computeStressWindows", () => {
  // 50-day series Jan 2024
  const dates = Array.from({ length: 50 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, i + 1));
    return d.toISOString().slice(0, 10);
  });
  const stratRet = Array.from({ length: 50 }, () => 0.001);
  const benchRet = Array.from({ length: 50 }, () => 0.002);

  it("drops windows entirely outside the observation series", () => {
    // COVID is 2020 — must NOT match a 2024-starting series.
    const out = computeStressWindows(dates, stratRet, benchRet, "BTC", ["BTC"]);
    expect(out.windows.find(w => w.name === "COVID crash")).toBeUndefined();
    expect(out.droppedOutOfRange).toBeGreaterThan(0);
  });

  it("filters catalogue by market asset class — crypto strategies skip pure-equity windows", () => {
    const crypto = computeStressWindows(dates, stratRet, benchRet, "BTC", ["BTC"]);
    const equityOnly = computeStressWindows(dates, stratRet, benchRet, "BTC", ["SPX"]);
    expect(crypto.totalCatalogued).not.toBe(equityOnly.totalCatalogued);
  });

  it("classifies perpetual-style tickers (BTCUSDT, ETHUSDT) as crypto", () => {
    // Regression for the BTCUSDT misclassification bug — bare-token regex
    // would silently route these strategies into equity windows.
    const ftxDates = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2022, 10, i + 1)).toISOString().slice(0, 10),
    );
    const r = Array.from({ length: 30 }, () => 0);
    const out = computeStressWindows(ftxDates, r, r, "BTC", ["BTCUSDT", "ETHUSDT"]);
    // FTX failure (crypto-only) catalogue entry should be in scope and match.
    const ftx = out.windows.find(w => w.name === "FTX failure");
    expect(ftx).toBeDefined();
  });

  it("falls back to all asset classes when no markets recognised", () => {
    // "AAPL" + "TSLA" wouldn't match crypto OR equity prefix — must fall back
    // to showing both rather than silently restricting to macro-only.
    const empty = computeStressWindows(dates, stratRet, benchRet, "BTC", []);
    const unknown = computeStressWindows(dates, stratRet, benchRet, "BTC", ["FAKE", "MADEUP"]);
    expect(unknown.totalCatalogued).toBe(empty.totalCatalogued);
  });

  it("returns 0 windows when no catalogue events overlap", () => {
    // Series in 2099 — no catalogued event can possibly match.
    const futureDates = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.UTC(2099, 0, i + 1)).toISOString().slice(0, 10),
    );
    const r = Array.from({ length: 10 }, () => 0);
    const out = computeStressWindows(futureDates, r, r, "BTC", ["BTC"]);
    expect(out.windows).toHaveLength(0);
  });

  it("benchmark and strategy returns differ when input arrays differ", () => {
    // Use a wide series that captures Aug 2024 unwind so a window actually evaluates.
    const wide = Array.from({ length: 365 }, (_, i) =>
      new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
    );
    const sr = Array.from({ length: 365 }, () => 0.001);
    const br = Array.from({ length: 365 }, () => -0.005);
    const out = computeStressWindows(wide, sr, br, "BTC", ["BTC"]);
    const aug = out.windows.find(w => w.name === "Aug 2024 unwind");
    // Rule 12: fail loud — if the window stops matching, the test must fail,
    // not silently skip its assertions.
    expect(aug).toBeDefined();
    if (!aug) return;
    expect(aug.benchReturn).not.toBeNull();
    expect(aug.stratReturn).toBeGreaterThan(aug.benchReturn as number);
  });

  it("drops windows whose coverage falls below MIN_COVERAGE_RATIO — avoids inventing data", () => {
    // Series starts 2020-03-18 — only the last ~6 days of the 33-day COVID
    // window are observed (~18% coverage). Must be dropped or labelled partial,
    // never reported as "COVID crash · −X%" implying full coverage.
    const partial = Array.from({ length: 40 }, (_, i) =>
      new Date(Date.UTC(2020, 2, 18 + i)).toISOString().slice(0, 10),
    );
    const r = Array.from({ length: 40 }, () => 0);
    const out = computeStressWindows(partial, r, r, "BTC", ["BTC"]);
    expect(out.windows.find(w => w.name === "COVID crash")).toBeUndefined();
    expect(out.droppedPartial).toBeGreaterThan(0);
  });

  it("tags partial-but-acceptable coverage explicitly", () => {
    // Series captures the SVB window (2023-03-08..2023-03-17, 10 calendar days)
    // starting 2023-03-12 → 6/10 = 60% coverage → above MIN, tagged "partial".
    const svb = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2023, 2, 12 + i)).toISOString().slice(0, 10),
    );
    const r = Array.from({ length: 30 }, () => 0);
    const out = computeStressWindows(svb, r, r, "BTC", ["BTC"]);
    const w = out.windows.find(x => x.name === "SVB / banking");
    expect(w).toBeDefined();
    if (!w) return;
    expect(w.coverage).toBe("partial");
    expect(w.expectedCalendarDays).toBeGreaterThan(w.days);
  });

  it("rejects non-ISO date format", () => {
    expect(() =>
      computeStressWindows(["2024-1-5"], [0], [0], "BTC", ["BTC"]),
    ).toThrow(/ISO/);
  });

  it("reports totalCatalogued >= windows.length", () => {
    const out = computeStressWindows(dates, stratRet, benchRet, "BTC", ["BTC"]);
    expect(out.totalCatalogued).toBeGreaterThanOrEqual(out.windows.length);
  });
  // Phase 169.5 CR-01 (SC3): an uncovered comparator day inside a window makes
  // that window's bench fields null, never a compounded 0% day. Before the fix the
  // caller entered a null as 0, so an unavailable BTC read rendered "BTC +0.00% /
  // DD 0.00%" through the Aug 2024 unwind.
  it("CR-01: a null comparator day inside a window nulls that window's bench fields, and only that window's", () => {
    const wide = Array.from({ length: 500 }, (_, i) =>
      new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
    );
    const sr = wide.map(() => 0.001);
    const br: Array<number | null> = wide.map(() => -0.005);
    br[wide.indexOf("2024-08-05")] = null;
    const out = computeStressWindows(wide, sr, br, "BTC", ["BTC"]);
    const aug = out.windows.find(w => w.name === "Aug 2024 unwind");
    const apr = out.windows.find(w => w.name === "Apr 2025 tariffs");
    expect(aug).toBeDefined();
    expect(apr).toBeDefined();
    if (!aug || !apr) return;
    expect(aug.benchReturn).toBeNull();
    expect(aug.benchMaxDD).toBeNull();
    // The strategy side is real data: the row stays, its strat fields numeric.
    expect(aug.stratReturn).toBeCloseTo(1.001 ** aug.days - 1, 12);
    // A fully covered window is unaffected: 8 days of -0.5%.
    expect(apr.benchReturn).toBeCloseTo(0.995 ** apr.days - 1, 12);
    expect(apr.benchMaxDD).toBeCloseTo(0.995 ** apr.days - 1, 12);
  });

  it("CR-01: an all-null comparator (the unavailable read) nulls every window's bench fields", () => {
    const wide = Array.from({ length: 500 }, (_, i) =>
      new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
    );
    const out = computeStressWindows(wide, wide.map(() => 0.001), wide.map(() => null), "BTC", ["BTC"]);
    expect(out.windows.length).toBeGreaterThan(0);
    for (const w of out.windows) {
      expect(w.benchReturn).toBeNull();
      expect(w.benchMaxDD).toBeNull();
    }
  });
});
