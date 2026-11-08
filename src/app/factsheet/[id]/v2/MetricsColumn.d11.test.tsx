/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { widenedShortNote, widenedWithheldReason } from "@/lib/figure-gate";
import type { FigureRecord, RollingVerdict } from "@/lib/figure-gate";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";
import { pct, pctSigned, ratio } from "./format";

/**
 * Phase 194 plan 15 (TRUST-05, D-11 / D-14 as superseded by D-15) - the factsheet rail's
 * rolling table, the added 1y table, section IV's overlap note and the cumulative CAGR.
 *
 * The verdicts are fixture inputs: plan 14 computes them once in the payload, and this rail
 * only reads them. Each case states the user-visible reason it matters, so a rule change
 * that keeps the test green is a rule change that kept the behaviour.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-194-15-rail",
  name: "D11 Rail Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const crypto = (spanDaysN: number): FigureRecord => ({ spanDays: spanDaysN, observations: null, crypto: true });

/** An n-day record with BTC closes covering every interval; `figureRecord` is set explicitly. */
function buildWith(n: number, record: FigureRecord | null, start = "2024-01-01"): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
    date: addDays(start, i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
    date: addDays(start, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return { ...payload, figureRecord: record };
}

/** A rolling series of `len` points whose first `warm` are null, then finite and distinct. */
function series(len: number, warm: number, base: number, step: number): Array<number | null> {
  return Array.from({ length: len }, (_, i) => (i < warm ? null : base + ((i * 7) % 13) * step));
}

/** The payload with the row-window verdict and arrays the plan-14 builder would have set. */
function withRows(payload: FactsheetPayload, label: "6mo" | "30d", annualization: RollingVerdict | undefined): FactsheetPayload {
  const n = payload.dates.length;
  const window = label === "6mo" ? 126 : 30;
  return {
    ...payload,
    rollingWindow: {
      window,
      label,
      enough: true,
      ...(annualization ? { annualization } : {}),
    },
    strategyRollingVol: series(n, window, 0.2, 0.01),
    strategyRollingSharpe: series(n, window, 0.5, 0.1),
    strategyRollingSortino: series(n, window, 0.8, 0.12),
  };
}

/** The 1y window plan 14 sets from 365 days: its own verdict (full) and its own three series. */
function with1y(payload: FactsheetPayload): FactsheetPayload {
  const n = payload.dates.length;
  return {
    ...payload,
    rollingWindow1y: {
      window: 366,
      label: "1y",
      enough: true,
      calendarDays: 365,
      annualization: { state: "full", days: 365, cause: null },
    },
    strategyRollingVol1y: series(n, 365, 0.35, 0.02),
    strategyRollingSharpe1y: series(n, 365, 1.1, 0.05),
    strategyRollingSortino1y: series(n, 365, 1.6, 0.07),
  };
}

function RangeHarness({ range }: { range: readonly [number, number] }) {
  const { setXRange } = useXRange();
  return (
    <button data-testid="zoom" onClick={() => setXRange(range)}>
      zoom
    </button>
  );
}

function mount(payload: FactsheetPayload, opts: { range?: readonly [number, number] } = {}) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness range={opts.range ?? [0, 1]} />
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

async function zoom() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("zoom"));
  });
}

function panel(title: string): HTMLElement {
  const h = [...document.querySelectorAll("h3")].find((el) => el.textContent === title);
  const p = h?.closest("section") as HTMLElement | null;
  if (!p) throw new Error(`no panel titled "${title}"`);
  return p;
}

/** The four cells (Now, Avg, Min, Max) of a rolling-table row. */
function cells(section: HTMLElement, label: string): string[] {
  const tr = [...section.querySelectorAll("tbody tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}"`);
  return [...tr.querySelectorAll("td")].slice(1).map((td) => td.textContent ?? "");
}

/** An independent oracle for the table's summary of `arr`: the last point, then avg, min and max of the finite ones. */
function expected(arr: Array<number | null>, fmt: (v: number | null) => string): string[] {
  const last = arr[arr.length - 1];
  const finite = arr.filter((v): v is number => v != null && Number.isFinite(v));
  const avg = finite.reduce((a, b) => a + b, 0) / finite.length;
  return [
    fmt(last != null && Number.isFinite(last) ? last : null),
    fmt(avg),
    fmt(Math.min(...finite)),
    fmt(Math.max(...finite)),
  ];
}

const volFmt = (v: number | null) => pct(v, 1);
const ratioFmt = (v: number | null) => ratio(v);
const rowsNote = () => document.querySelector('[data-testid="rolling-annualization-note"]');
const ROWS = ["Volatility", "Sharpe", "Sortino"] as const;

describe("rail rolling table - the payload's verdict (D-11 as superseded by D-15)", () => {
  it("withheld by the gate: every cell of all three rows is a dash with no accent, and ONE line names the bound and the record's days", () => {
    // Why it matters: a 59-day crypto record has not earned an annualized rolling figure; the
    // reader must see a dash and the reason, never a confident Sharpe over a record this short.
    const record = crypto(59);
    mount(withRows(buildWith(401, record), "6mo", { state: "withheld", days: 59, cause: "gate" }));
    const section = panel("Rolling Metrics (6mo)");
    for (const label of ROWS) expect(cells(section, label)).toEqual(["—", "—", "—", "—"]);
    expect(section.querySelector(".text-accent")).toBeNull();
    expect(document.querySelectorAll('[data-testid="rolling-annualization-note"]')).toHaveLength(1);
    expect(rowsNote()?.textContent).toBe(widenedWithheldReason("rolling", record));
  });

  it("withheld for want of a full window past a cleared gate: dashes, and the line is the rolling-record sentence with the record's days", () => {
    // Why it matters: "the record is too short to annualize" and "the record is long enough but
    // holds no full window" are different facts; saying the first would send the reader chasing
    // the wrong threshold.
    const record = crypto(120);
    mount(withRows(buildWith(401, record), "6mo", { state: "withheld", days: 20, cause: "record" }));
    const section = panel("Rolling Metrics (6mo)");
    for (const label of ROWS) expect(cells(section, label)).toEqual(["—", "—", "—", "—"]);
    expect(rowsNote()?.textContent).toBe(widenedWithheldReason("rolling-record", record));
  });

  it("short at 29 days (the 30-row window, D-15): the figures print and the line says 29 days", () => {
    // Why it matters: D-15 shows a cleared record's short windows; the reader is told the window
    // is under a year instead of having the figures taken away.
    const payload = withRows(buildWith(401, crypto(400)), "30d", { state: "short", days: 29, cause: null });
    mount(payload);
    const section = panel("Rolling Metrics (30d)");
    expect(cells(section, "Volatility")).toEqual(expected(payload.strategyRollingVol, volFmt));
    expect(cells(section, "Sharpe")).toEqual(expected(payload.strategyRollingSharpe, ratioFmt));
    expect(cells(section, "Sortino")).toEqual(expected(payload.strategyRollingSortino, ratioFmt));
    expect(rowsNote()?.textContent).toBe(widenedShortNote("rolling", 29));
  });

  it("short at 125 days (the 6mo window): the figures print as the payload carries them and the line says 125 days", () => {
    const payload = withRows(buildWith(201, crypto(200)), "6mo", { state: "short", days: 125, cause: null });
    mount(payload);
    const section = panel("Rolling Metrics (6mo)");
    expect(cells(section, "Sharpe")).toEqual(expected(payload.strategyRollingSharpe, ratioFmt));
    expect(rowsNote()?.textContent).toBe(widenedShortNote("rolling", 125));
  });

  it("no annualization key (record unknown): the figures show and there is no note", () => {
    const payload = withRows(buildWith(401, crypto(400)), "6mo", undefined);
    mount(payload);
    const section = panel("Rolling Metrics (6mo)");
    expect(cells(section, "Volatility")).toEqual(expected(payload.strategyRollingVol, volFmt));
    expect(rowsNote()).toBeNull();
  });
});

describe("rail rolling table - the added 1y table is ADDITIVE (D-14)", () => {
  const SHORT_125: RollingVerdict = { state: "short", days: 125, cause: null };

  it("a 400-day record renders BOTH tables: the 6mo one with its rows and its 125-day note, then the 1y one over its own arrays with no note", () => {
    // Why it matters: D-14 ADDS a window. A rail that swapped the 6mo table for the 1y one for
    // every record of a year or more would silently take away the window readers already use.
    const payload = with1y(withRows(buildWith(401, crypto(400)), "6mo", SHORT_125));
    mount(payload);

    const six = panel("Rolling Metrics (6mo)");
    expect(cells(six, "Volatility")).toEqual(expected(payload.strategyRollingVol, volFmt));
    expect(cells(six, "Sharpe")).toEqual(expected(payload.strategyRollingSharpe, ratioFmt));
    expect(cells(six, "Sortino")).toEqual(expected(payload.strategyRollingSortino, ratioFmt));
    expect(six.contains(rowsNote())).toBe(true);
    expect(rowsNote()?.textContent).toBe(widenedShortNote("rolling", 125));

    const wrapper = document.querySelector('[data-testid="rolling-metrics-1y"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    const oneYear = panel("Rolling Metrics (1y)");
    expect(wrapper.contains(oneYear)).toBe(true);
    expect(cells(oneYear, "Volatility")).toEqual(expected(payload.strategyRollingVol1y!, volFmt));
    expect(cells(oneYear, "Sharpe")).toEqual(expected(payload.strategyRollingSharpe1y!, ratioFmt));
    expect(cells(oneYear, "Sortino")).toEqual(expected(payload.strategyRollingSortino1y!, ratioFmt));
    expect(wrapper.querySelector("p")).toBeNull();
    // 6mo first, 1y after it, in the same stack.
    expect(six.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a selected range restricts BOTH tables to the range's indices", async () => {
    // Why it matters: while a range is selected every rail figure describes that range, so the
    // rolling tables must summarise the same slice the rolling charts draw.
    const payload = with1y(withRows(buildWith(401, crypto(400)), "6mo", SHORT_125));
    mount(payload, { range: [200, 399] });
    await zoom();
    const slice = (a: Array<number | null>) => a.slice(200, 400);
    const six = panel("Rolling Metrics (6mo)");
    const oneYear = panel("Rolling Metrics (1y)");
    expect(cells(six, "Sharpe")).toEqual(expected(slice(payload.strategyRollingSharpe), ratioFmt));
    expect(cells(oneYear, "Sharpe")).toEqual(expected(slice(payload.strategyRollingSharpe1y!), ratioFmt));
    expect(cells(oneYear, "Volatility")).toEqual(expected(slice(payload.strategyRollingVol1y!), volFmt));
    // The two arrays differ over the slice, so a table reading the wrong array cannot pass.
    expect(cells(six, "Sharpe")).not.toEqual(cells(oneYear, "Sharpe"));
  });

  it("a 200-day record (rollingWindow1y null, plan 14) has no 1y table", () => {
    const payload = withRows(buildWith(201, crypto(200)), "6mo", SHORT_125);
    mount({ ...payload, rollingWindow1y: null, strategyRollingVol1y: null, strategyRollingSharpe1y: null, strategyRollingSortino1y: null });
    expect(document.querySelector('[data-testid="rolling-metrics-1y"]')).toBeNull();
    expect(() => panel("Rolling Metrics (1y)")).toThrow();
    expect(panel("Rolling Metrics (6mo)")).not.toBeNull();
  });
});

/** The value cell (strategy column) of a row inside the panel titled `title`. */
function value(title: string, label: string): string {
  const tr = [...panel(title).querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return tr.querySelectorAll("td")[1]?.textContent ?? "";
}

type JointMarker = NonNullable<FactsheetPayload["comparators"]["btc"]["jointAnnualization"]>;

/**
 * The BTC comparator block with the marker plan 21 would set. `nanFigures` blanks the four
 * annualized joint figures the way plan 21 does when withheld; the rest keep their values.
 */
function withJoint(
  payload: FactsheetPayload,
  marker: JointMarker | undefined,
  opts: { nanFigures?: boolean; flatLeg?: boolean } = {},
): FactsheetPayload {
  const block = payload.comparators.btc;
  if (!block.joint) throw new Error("fixture must carry a computed joint");
  const joint = opts.nanFigures
    ? { ...block.joint, alpha: NaN, info_ratio: NaN, tracking_error: NaN, treynor: NaN }
    : block.joint;
  // Plan 21's builder sets its own marker from the record; drop it so `marker` alone decides.
  const { jointAnnualization: _builderMarker, ...rest } = block;
  void _builderMarker;
  return {
    ...payload,
    activeComparator: "btc",
    comparators: {
      ...payload.comparators,
      btc: {
        ...rest,
        joint,
        ...(marker ? { jointAnnualization: marker } : {}),
        ...(opts.flatLeg ? { flatLeg: true } : {}),
      },
    },
  };
}

const jointNote = () => document.querySelector('[data-testid="joint-annualization-note"]');

describe("section IV - the overlap annualization note (D-11 as superseded by D-15)", () => {
  it("withheld on a 45-day crypto record: alpha, IR, Treynor and TE read a dash, beta/correlation/R2/captures keep their values, and the line names the RECORD's bound", () => {
    // Why it matters: those four are annualized, so a record under the bound must not print
    // them; the other five are not annualized, so withholding them too would hide real data.
    const record = crypto(45);
    const payload = withJoint(buildWith(120, record), { state: "withheld", days: 45 }, { nanFigures: true });
    const joint = payload.comparators.btc.joint!;
    mount(payload);
    expect(value("Joint Metrics", "Alpha (ann)")).toBe("—");
    expect(value("Joint Metrics", "Information Ratio")).toBe("—");
    expect(value("Joint Metrics", "Treynor")).toBe("—");
    expect(value("Joint Metrics", "Tracking Error")).toBe("—");
    expect(value("Joint Metrics", "Beta")).toBe(ratio(joint.beta));
    expect(value("Joint Metrics", "Correlation")).toBe(ratio(joint.corr));
    expect(value("Joint Metrics", "R²")).toBe(ratio(joint.r2));
    expect(value("Joint Metrics", "Up Capture")).toBe(ratio(joint.up_capture));
    expect(value("Joint Metrics", "Down Capture")).toBe(ratio(joint.down_capture));
    expect(document.querySelectorAll('[data-testid="joint-annualization-note"]')).toHaveLength(1);
    expect(jointNote()?.textContent).toBe(widenedWithheldReason("overlap", record));
  });

  it("short at 45 days on a CLEARED record (D-15): the values show and the line says 45 days of overlap", () => {
    // Why it matters: a 45-day overlap inside a 100-day record is qualified, not withheld.
    const payload = withJoint(buildWith(120, crypto(100)), { state: "short", days: 45 });
    const joint = payload.comparators.btc.joint!;
    mount(payload);
    expect(value("Joint Metrics", "Beta")).toBe(ratio(joint.beta));
    expect(value("Joint Metrics", "Information Ratio")).toBe(ratio(joint.info_ratio));
    expect(jointNote()?.textContent).toBe(widenedShortNote("overlap", 45));
  });

  it("short at 200 days: the values show and the line says 200 days", () => {
    const payload = withJoint(buildWith(260, crypto(250)), { state: "short", days: 200 });
    mount(payload);
    expect(jointNote()?.textContent).toBe(widenedShortNote("overlap", 200));
  });

  it("no marker: no note", () => {
    mount(withJoint(buildWith(120, crypto(400)), undefined));
    expect(jointNote()).toBeNull();
  });

  it("a flat leg and a marker together: the flat-leg reason renders BESIDE the new note", () => {
    mount(withJoint(buildWith(120, crypto(100)), { state: "short", days: 45 }, { flatLeg: true }));
    expect(document.querySelector('[data-testid="joint-flat-leg-reason"]')).not.toBeNull();
    expect(jointNote()).not.toBeNull();
  });
});

describe("Cumulative Return Metrics - CAGR is gated by the record verdict (D-04 as superseded by D-15)", () => {
  const cagrRow = () => value("Cumulative Return Metrics", "CAGR");

  it("a 60-day crypto record prints a dash: the one rail CAGR plan 04 had not routed", () => {
    // Why it matters: Main Metrics already dashes this CAGR for the same record; the panel
    // must not print the number the rail's headline row withholds.
    mount(buildWith(61, crypto(60)));
    expect(value("Main Metrics", "CAGR")).toBe("—");
    expect(cagrRow()).toBe("—");
  });

  it("a 400-day record prints the stored CAGR", () => {
    const payload = buildWith(401, crypto(400));
    mount(payload);
    expect(cagrRow()).toBe(pctSigned(payload.strategyMetrics.cagr, 2));
    expect(cagrRow()).not.toBe("—");
  });

  it("a non-crypto record of 60 observations over 84 days prints the CAGR (D-15: the bound is observations)", () => {
    const payload = buildWith(120, { spanDays: 84, observations: 60, crypto: false });
    mount(payload);
    expect(cagrRow()).toBe(pctSigned(payload.strategyMetrics.cagr, 2));
    expect(cagrRow()).not.toBe("—");
  });
});
