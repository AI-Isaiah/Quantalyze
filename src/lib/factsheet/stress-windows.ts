import type { StressWindow, StressWindowPayload } from "./types";

/**
 * Named market-stress windows. Allocators want to see how a strategy fared
 * during specific cataclysms even when the headline DD table doesn't catch
 * them. Catalogue covers major macro + crypto events post-2015. Windows
 * outside the observed series, or with coverage too partial to be honest,
 * are dropped (see MIN_COVERAGE_RATIO).
 */
type AssetClass = "crypto" | "equity" | "macro" | "all";
type WindowDef = {
  name: string;
  start: string;
  end: string;
  note: string;
  classes: AssetClass[];
};

/**
 * Catalogue of named stress windows tagged by relevant asset classes. The
 * matcher filters by the strategy's declared markets so a US-equity strategy
 * doesn't get a list dominated by crypto events it would never have touched.
 *
 * Adding a window: pick the right `classes` tags so it surfaces for relevant
 * strategies only.
 */
const WINDOWS: WindowDef[] = [
  // Macro / all-asset shocks
  { name: "COVID crash", start: "2020-02-19", end: "2020-03-23", note: "S&P −34% in 33 days", classes: ["macro", "equity", "crypto"] },
  { name: "Volmageddon", start: "2018-02-02", end: "2018-02-09", note: "XIV blow-up · VIX +116%", classes: ["macro", "equity"] },
  { name: "Q4 2018 selloff", start: "2018-10-03", end: "2018-12-24", note: "fed-pivot drawdown", classes: ["macro", "equity"] },
  { name: "Aug 2015 China", start: "2015-08-18", end: "2015-08-25", note: "PBoC devaluation shock", classes: ["macro", "equity"] },
  { name: "SVB / banking", start: "2023-03-08", end: "2023-03-17", note: "regional-bank run", classes: ["macro", "equity", "crypto"] },
  { name: "Aug 2024 unwind", start: "2024-08-02", end: "2024-08-09", note: "JPY carry-trade unwind", classes: ["macro", "equity", "crypto"] },
  { name: "Apr 2025 tariffs", start: "2025-04-02", end: "2025-04-09", note: "tariff escalation shock", classes: ["macro", "equity", "crypto"] },
  // Crypto-native
  { name: "TerraLuna collapse", start: "2022-05-08", end: "2022-05-20", note: "UST depeg → cascade", classes: ["crypto"] },
  { name: "3AC / Celsius", start: "2022-06-08", end: "2022-06-30", note: "crypto credit unwind", classes: ["crypto"] },
  { name: "FTX failure", start: "2022-11-06", end: "2022-11-22", note: "SBF / Alameda collapse", classes: ["crypto"] },
];

/** Below this ratio of (actualDays / expectedCalendarDays) the window is too partial to label honestly. */
const MIN_COVERAGE_RATIO = 0.4;

/**
 * Prefix-match crypto/equity roots. Permissive on suffix so BTC, BTCUSDT,
 * BTC-PERP, BTCUSDC.P all classify as crypto. False-positive cost is "show
 * one extra stress window" — the alternative (silently misclassify a crypto
 * strategy as equity) is much worse.
 */
const CRYPTO_ROOTS = /^(BTC|ETH|SOL|XBT|LUNA|XRP|DOGE|MATIC|AVAX|ADA|DOT|LINK|UNI|LTC|BCH)/i;
const EQUITY_ROOTS = /^(SPX|SPY|QQQ|NDX|S&P|EQUIT|STOCK|US|EU|JP|UK|DAX|FTSE|NIKKEI|HSI)/i;

/** Map a strategy's `markets` list to the asset-class tags used by WINDOWS. */
function classifyMarkets(markets: string[]): Set<AssetClass> {
  const out = new Set<AssetClass>(["macro"]);
  let classified = 0;
  for (const m of markets) {
    if (CRYPTO_ROOTS.test(m)) { out.add("crypto"); classified++; continue; }
    if (EQUITY_ROOTS.test(m)) { out.add("equity"); classified++; continue; }
  }
  if (markets.length === 0 || classified === 0) {
    // No markets, or none recognised → show everything rather than silently restrict.
    out.add("crypto");
    out.add("equity");
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compute strategy + comparator return during each in-range window. Drops
 * windows whose actual coverage of the catalogue date range is below
 * MIN_COVERAGE_RATIO — otherwise the "COVID crash" label would imply a full
 * 33-day window while showing 4 days, which the `no_invented_data` rule
 * forbids.
 *
 * Throws if `dates` is not ISO-formatted (YYYY-MM-DD), because the
 * lexicographic compares against catalogue dates assume zero-padded ISO.
 */
export function computeStressWindows(
  dates: string[],
  stratRet: number[],
  benchRet: number[],
  benchName: string,
  markets: string[] = [],
): StressWindowPayload {
  if (dates.length > 0 && !ISO_DATE.test(dates[0])) {
    throw new Error(`stress-windows: dates must be ISO (YYYY-MM-DD); got "${dates[0]}"`);
  }
  const classes = classifyMarkets(markets);
  const relevant = WINDOWS.filter(w => w.classes.some(c => classes.has(c) || c === "all"));
  const windows: StressWindow[] = [];
  let droppedOutOfRange = 0;
  let droppedPartial = 0;
  for (const def of relevant) {
    const startIdx = firstAfter(dates, def.start);
    const endIdx = lastBefore(dates, def.end);
    // `firstAfter` returns idx where dates[idx] ≥ def.start, so dates[startIdx]
    // > def.end is the meaningful out-of-range guard (the earliest in-series
    // date sits past the window's end). The reverse — dates[endIdx] < def.start —
    // is impossible once endIdx ≥ startIdx and so doesn't need a guard.
    if (
      startIdx == null ||
      endIdx == null ||
      endIdx < startIdx ||
      dates[startIdx] > def.end
    ) {
      droppedOutOfRange++;
      continue;
    }

    const actualDays = endIdx - startIdx + 1;
    const expectedCalendarDays = calendarDaysBetween(def.start, def.end);
    // Use trading-day denominator for non-crypto events (M-F only); crypto
    // catalogue entries trade 7d/wk so calendar days IS the trading-day count.
    // Without this split, equity/macro windows like SVB (10 cal days, ~6 tdays)
    // would be flagged "partial" even when every trading day is observed.
    const isCryptoEvent = def.classes.length === 1 && def.classes[0] === "crypto";
    const expectedDays = isCryptoEvent
      ? expectedCalendarDays
      : tradingDaysBetween(def.start, def.end);
    const coverageRatio = expectedDays > 0 ? actualDays / expectedDays : 0;
    if (coverageRatio < MIN_COVERAGE_RATIO) {
      droppedPartial++;
      continue;
    }

    let stratCum = 1;
    let benchCum = 1;
    let stratPeak = 1;
    let benchPeak = 1;
    let stratMaxDD = 0;
    let benchMaxDD = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      stratCum *= 1 + stratRet[i];
      benchCum *= 1 + benchRet[i];
      if (stratCum > stratPeak) stratPeak = stratCum;
      if (benchCum > benchPeak) benchPeak = benchCum;
      const stratDD = stratCum / stratPeak - 1;
      const benchDD = benchCum / benchPeak - 1;
      if (stratDD < stratMaxDD) stratMaxDD = stratDD;
      if (benchDD < benchMaxDD) benchMaxDD = benchDD;
    }
    windows.push({
      name: def.name,
      note: def.note,
      start: dates[startIdx],
      end: dates[endIdx],
      days: actualDays,
      expectedCalendarDays: expectedDays,
      coverage: coverageRatio >= 0.85 ? "full" : "partial",
      stratReturn: stratCum - 1,
      benchReturn: benchCum - 1,
      stratMaxDD,
      benchMaxDD,
    });
  }
  return {
    windows,
    benchName,
    totalCatalogued: relevant.length,
    droppedOutOfRange,
    droppedPartial,
  };
}

/** First index in `dates` with date ≥ target. Null if none. */
function firstAfter(dates: string[], target: string): number | null {
  for (let i = 0; i < dates.length; i++) if (dates[i] >= target) return i;
  return null;
}

/** Last index in `dates` with date ≤ target. Null if none. */
function lastBefore(dates: string[], target: string): number | null {
  for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= target) return i;
  return null;
}

/** Inclusive calendar days between two ISO YYYY-MM-DD dates. */
function calendarDaysBetween(start: string, end: string): number {
  const a = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const b = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Inclusive Mon–Fri days between two ISO dates. Holidays not modelled — these
 *  are approximations for "did the strategy observe an honest slice of the
 *  trading-day window"; ~5% over-count from holidays is acceptable signal. */
function tradingDaysBetween(start: string, end: string): number {
  const a = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const b = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  let count = 0;
  for (let t = a; t <= b; t += 86_400_000) {
    const day = new Date(t).getUTCDay(); // 0=Sun ... 6=Sat
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
