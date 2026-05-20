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
    expect(aug.stratReturn).toBeGreaterThan(aug.benchReturn);
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
});
