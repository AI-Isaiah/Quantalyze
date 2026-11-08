/**
 * Phase 194 plan 03 (TRUST-05, D-15): the one figure verdict. Each case pins WHY a
 * boundary sits where it does: a figure the record is too short to annualise is
 * withheld, a window shorter than a year only earns a note, and nothing about a
 * figure's size changes the verdict (D-05).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { annualizationPeriods, blendPeriodsPerYear } from "@/lib/closed-sets";
import {
  ANNUALIZED_KEYS,
  FIGURE_DEFS_VERSION,
  MIN_ANNUALIZATION_DAYS,
  MIN_ANNUALIZATION_OBS,
  ONE_YEAR_DAYS,
  SHORT_TRACK_MARKER,
  VAR_METHOD_LINE,
  figureRecord,
  figureSpan,
  gateAnnualized,
  gatedValue,
  notShownLine,
  recordClears,
  shortTrackMarkerTitle,
  shortTrackNote,
  coveredDays,
  spanDays,
  windowNeedsTitle,
  withheldCellTitle,
  withheldReason,
  type FigureRecord,
} from "./figure-gate";

const crypto = (span: number | null, observations: number | null = null): FigureRecord => ({
  spanDays: span,
  observations,
  crypto: true,
});
const trad = (observations: number | null, span: number | null): FigureRecord => ({
  spanDays: span,
  observations,
  crypto: false,
});

describe("crypto record (calendar-day bound, D-15)", () => {
  it.each([
    [0, "withheld"], // a single return spans 0 days
    [89, "withheld"],
    [90, "short"],
    [364, "short"],
    [365, "full"],
  ] as const)("a %i-day record is %s", (span, state) => {
    expect(gateAnnualized(crypto(span))).toBe(state);
  });

  it("an unknown span is the null state, not withheld and not shown", () => {
    expect(gateAnnualized(crypto(null))).toBe("null");
    expect(recordClears(crypto(null))).toBeNull();
  });
});

describe("non-crypto record (observation bound, D-15)", () => {
  it("59 observations withheld, 60 short", () => {
    expect(gateAnnualized(trad(59, 83))).toBe("withheld");
    expect(gateAnnualized(trad(60, 90))).toBe("short");
  });

  it("60 observations spanning 84 days are short: the bound is observations, not days", () => {
    expect(gateAnnualized(trad(60, 84))).toBe("short");
  });

  it("300 observations over 420 days are full; 1 observation is withheld", () => {
    expect(gateAnnualized(trad(300, 420))).toBe("full");
    expect(gateAnnualized(trad(1, 0))).toBe("withheld");
  });

  it("A-194-D15-02: a stored row without a count falls back to the 90-day bound", () => {
    expect(gateAnnualized(trad(null, 89))).toBe("withheld");
    expect(gateAnnualized(trad(null, 90))).toBe("short");
    expect(gateAnnualized(trad(null, null))).toBe("null");
  });
});

describe("blend record: crypto if any leg is, or is unknown (blendPeriodsPerYear)", () => {
  // The blend's record is built from the legs' basis; the span is set directly so each case
  // states the exact span it means.
  const blend = (legs: { asset_class: string | null }[], observations: number, span: number): FigureRecord => ({
    ...figureRecord({ seriesStart: null, seriesEnd: null, observations, periodsPerYear: blendPeriodsPerYear(legs) }),
    spanDays: span,
  });

  it("one crypto leg: 70 observations over 70 days are withheld (crypto bound 90 days)", () => {
    expect(gateAnnualized(blend([{ asset_class: "crypto" }, { asset_class: "traditional" }], 70, 70))).toBe("withheld");
  });

  it("two traditional legs: the same 70 observations clear (60 observations)", () => {
    expect(gateAnnualized(blend([{ asset_class: "traditional" }, { asset_class: "traditional" }], 70, 70))).toBe("short");
  });

  it("an unknown-class leg reads crypto (RANK-06): 70 observations over 69 days are withheld", () => {
    expect(gateAnnualized(blend([{ asset_class: "traditional" }, { asset_class: null }], 70, 69))).toBe("withheld");
  });
});

describe("the window qualifies a cleared record and never withholds it (D-15)", () => {
  const long = crypto(400);

  it("a 20-day selected range inside a cleared record is short, never withheld", () => {
    expect(gateAnnualized(long, 20)).toBe("short");
    expect(gateAnnualized(long, 0)).toBe("short");
  });

  it("a window of 365 days is full; an unknown window is null", () => {
    expect(gateAnnualized(long, 365)).toBe("full");
    expect(gateAnnualized(long, 364)).toBe("short");
    expect(gateAnnualized(long, null)).toBe("null");
  });

  it("a record that fails the minimum withholds under every window", () => {
    expect(gateAnnualized(crypto(60), 400)).toBe("withheld");
    expect(gateAnnualized(trad(30, 40), 365)).toBe("withheld");
  });
});

describe("figureSpan and figureRecord", () => {
  it("spanDays is the calendar gap between UTC dates; coveredDays counts both ends (D-20)", () => {
    expect(spanDays("2025-01-01", "2025-01-31")).toBe(30);
    expect(spanDays("2025-01-01", "2026-01-01")).toBe(365);
    expect(coveredDays("2025-01-01", "2025-01-31")).toBe(31);
    expect(coveredDays("2025-01-01", "2025-01-01")).toBe(1);
  });

  // 194 D-20 (founder, 2026-11-08, "Count returns"): each daily return covers one day, so one
  // year of daily returns (2025-01-01 .. 2025-12-31) is 365 days of record, no under-1y note.
  it("D-20 boundary: 365 daily returns are a full year, 364 are short", () => {
    const full = figureRecord({ seriesStart: "2025-01-01", seriesEnd: "2025-12-31", observations: 365, periodsPerYear: 365 });
    const short = figureRecord({ seriesStart: "2025-01-01", seriesEnd: "2025-12-30", observations: 364, periodsPerYear: 365 });
    expect(full.spanDays).toBe(365);
    expect(short.spanDays).toBe(364);
    expect(gateAnnualized(full)).toBe("full");
    expect(gateAnnualized(short)).toBe("short");
  });

  it("D-20 boundary: 90 daily crypto returns clear the record minimum, 89 do not", () => {
    const at90 = figureRecord({ seriesStart: "2025-01-01", seriesEnd: "2025-03-31", observations: 90, periodsPerYear: 365 });
    const at89 = figureRecord({ seriesStart: "2025-01-01", seriesEnd: "2025-03-30", observations: 89, periodsPerYear: 365 });
    expect(at90.spanDays).toBe(90);
    expect(at89.spanDays).toBe(89);
    expect(gateAnnualized(at90)).toBe("short");
    expect(gateAnnualized(at89)).toBe("withheld");
  });

  it("chain-broken: the span starts at headline_since, 62 days here, so a crypto record is withheld", () => {
    const span = figureSpan({ seriesStart: "2025-01-01", seriesEnd: "2026-01-01", headlineSince: "2025-11-01" });
    expect(span).toBe(62);
    expect(gateAnnualized(crypto(span))).toBe("withheld");
  });

  it("a headline_since before the series start does not extend the span", () => {
    expect(figureSpan({ seriesStart: "2025-06-01", seriesEnd: "2025-07-01", headlineSince: "2025-01-01" })).toBe(31);
  });

  it("a missing end is a null span", () => {
    expect(figureSpan({ seriesStart: null, seriesEnd: "2025-07-01" })).toBeNull();
    expect(figureSpan({ seriesStart: "2025-06-01", seriesEnd: undefined })).toBeNull();
  });

  it("crypto comes from periodsPerYear 365, the house convention", () => {
    const base = { seriesStart: "2025-01-01", seriesEnd: "2025-06-01", observations: 100 };
    expect(figureRecord({ ...base, periodsPerYear: annualizationPeriods("crypto") }).crypto).toBe(true);
    expect(figureRecord({ ...base, periodsPerYear: annualizationPeriods("traditional") }).crypto).toBe(false);
    expect(figureRecord({ ...base, periodsPerYear: annualizationPeriods(null) }).crypto).toBe(false);
  });

  it("a non-finite observation count is stored as null, never as a number", () => {
    const rec = figureRecord({ seriesStart: "2025-01-01", seriesEnd: "2025-06-01", observations: NaN, periodsPerYear: 252 });
    expect(rec.observations).toBeNull();
  });
});

describe("D-05: no verdict looks at a figure's size", () => {
  it("a 1.2e13 cumulative return gets the verdict of any finite value", () => {
    const rec = crypto(120);
    const state = gateAnnualized(rec);
    expect(state).toBe("short");
    expect(gatedValue(1.2e13, state)).toBe(1.2e13);
    expect(gatedValue(0.01, state)).toBe(0.01);
    expect(gatedValue(1.2e13, "withheld")).toBeNull();
  });

  it("gatedValue never turns a missing or withheld figure into a number", () => {
    expect(gatedValue(null, "full")).toBeNull();
    expect(gatedValue(undefined, "short")).toBeNull();
    expect(gatedValue(NaN, "full")).toBeNull();
    expect(gatedValue(0.5, "withheld")).toBeNull();
  });

  it("names the annualised figure keys every surface gates", () => {
    expect(ANNUALIZED_KEYS).toEqual(["cagr", "volatility", "ann_vol", "sharpe", "sortino", "calmar"]);
  });
});

describe("copy (UI-SPEC Copywriting Contract, verbatim)", () => {
  it("withheld reason names the bound that decided, with counts that agree", () => {
    expect(withheldReason("record", crypto(1))).toBe(
      "Annualized figures appear once the record reaches 90 days. This record covers 1 day.",
    );
    expect(withheldReason("record", crypto(89))).toBe(
      "Annualized figures appear once the record reaches 90 days. This record covers 89 days.",
    );
    expect(withheldReason("record", trad(1, 0))).toBe(
      "Annualized figures appear once the record reaches 60 trading days. This record has 1 trading day.",
    );
    expect(withheldReason("record", trad(59, 83))).toBe(
      "Annualized figures appear once the record reaches 60 trading days. This record has 59 trading days.",
    );
    // the interim fallback names the 90-day bound that decided it
    expect(withheldReason("record", trad(null, 40))).toBe(
      "Annualized figures appear once the record reaches 90 days. This record covers 40 days.",
    );
    expect(withheldReason("blend", crypto(12))).toBe(
      "Annualized figures appear once the blend's overlapping record reaches 90 days. It covers 12 days.",
    );
    expect(withheldReason("blend", trad(1, 0))).toBe(
      "Annualized figures appear once the blend's overlapping record reaches 60 trading days. It has 1 trading day.",
    );
  });

  it("withheld cell title", () => {
    expect(withheldCellTitle(crypto(45))).toBe("Withheld until the record reaches 90 days (45 days so far).");
    expect(withheldCellTitle(trad(1, 0))).toBe("Withheld until the record reaches 60 trading days (1 so far).");
  });

  it("short-track note by scope, with thousands separators and day/days agreement", () => {
    expect(shortTrackNote("record", 200)).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 200 days of record, under one year.",
    );
    expect(shortTrackNote("blend", 1)).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 1 day of overlapping record, under one year.",
    );
    expect(shortTrackNote("range", 20)).toBe(
      "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 20 days of the selected range, under one year.",
    );
    expect(withheldReason("record", crypto(1234))).toContain("covers 1,234 days");
  });

  it("marker, window titles, method line", () => {
    expect(SHORT_TRACK_MARKER).toBe("<1y");
    expect(shortTrackMarkerTitle(120)).toBe("Annualized from 120 days of record, under one year.");
    expect(windowNeedsTitle("6m")).toBe("6 Month needs 182 days of record.");
    expect(windowNeedsTitle("3m")).toBe("3 Month needs 91 days of record.");
    expect(VAR_METHOD_LINE).toBe(
      "VaR and CVaR are historical and 1-day: VaR is the loss exceeded on 5% of days in the record, CVaR the average loss on those days.",
    );
  });

  it("not-shown line: hidden at 0, singular, plural, and the or-list", () => {
    expect(notShownLine(0, ["Sharpe"])).toBeNull();
    expect(notShownLine(1, ["Sharpe"])).toBe("Not shown: 1 strategy with no figure for Sharpe.");
    expect(notShownLine(1200, ["Sharpe"])).toBe("Not shown: 1,200 strategies with no figure for Sharpe.");
    expect(notShownLine(3, ["Return %", "CAGR"])).toBe("Not shown: 3 strategies with no figure for Return % or CAGR.");
    expect(notShownLine(3, ["Return %", "CAGR", "Sharpe"])).toBe(
      "Not shown: 3 strategies with no figure for Return %, CAGR or Sharpe.",
    );
  });
});

describe("one definition: TS constants equal the Python constants (text-read pin)", () => {
  const py = readFileSync(resolve(process.cwd(), "analytics-service/services/metrics.py"), "utf8");
  const read = (name: string): number => {
    const hits = [...py.matchAll(new RegExp(`^${name} = (\\d+)\\s*$`, "gm"))];
    expect(hits, `${name} must be defined exactly once in metrics.py`).toHaveLength(1);
    return Number(hits[0][1]);
  };

  it("MIN_ANNUALIZATION_DAYS, MIN_ANNUALIZATION_OBS and FIGURE_DEFS_VERSION agree", () => {
    expect(read("MIN_ANNUALIZATION_DAYS")).toBe(MIN_ANNUALIZATION_DAYS);
    expect(read("MIN_ANNUALIZATION_OBS")).toBe(MIN_ANNUALIZATION_OBS);
    expect(read("FIGURE_DEFS_VERSION")).toBe(FIGURE_DEFS_VERSION);
  });

  it("D-20: the Python record span counts both ends, like coveredDays", () => {
    const fn = py.slice(py.indexOf("def _index_span_days"));
    const body = fn.slice(0, fn.indexOf("\n\n\ndef "));
    expect(body).toMatch(/return int\(\(dt\.max\(\) - dt\.min\(\)\)\.days\) \+ 1/);
  });

  it("ONE_YEAR_DAYS is a calendar year", () => {
    expect(ONE_YEAR_DAYS).toBe(365);
  });
});
