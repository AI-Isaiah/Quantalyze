/**
 * Phase 170.2 plan 04 (SC-3): /compare's equity overlay draws the stored
 * `returns_series` CURVE, never a compounding of it.
 *
 * `strategy_analytics.returns_series` stores equity LEVELS on a base of 1.0
 * (geometric = (1+r).cumprod(), simple = 1 + r.cumsum()). The old overlay did
 * `cum *= 1 + p.value` over those levels, so a 112-point curve ending at 1.1454
 * read about 1e35 percent while the table beside it said +14.54%.
 *
 * The oracle is an independent invariant, not the implementation: the last
 * plotted point of every drawn line must equal the strategy's STORED
 * `cumulative_return * 100`, and the tooltip string of that point must equal
 * the string the CompareTable's Cumulative Return cell prints
 * (`formatPercent(cumulative_return)`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CompareEquityOverlay } from "./CompareEquityOverlay";
import { formatPercent } from "@/lib/utils";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type Row = Record<string, number | string>;
type TooltipFormatter = (value: unknown, name: unknown) => [string, string];

const captured: { data: Row[]; formatter: TooltipFormatter | null } = {
  data: [],
  formatter: null,
};

// ResponsiveContainer measures 0x0 in jsdom, so it is a plain div, and the
// chart root records the `data` it was handed (the RiskDecomposition idiom,
// plus a data-capturing LineChart).
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    LineChart: ({ data, children }: { data: Row[]; children: ReactNode }) => {
      captured.data = data;
      return <div data-testid="line-chart">{children}</div>;
    },
  };
});

// The shim wraps recharts' Tooltip. Recording its `formatter` prop tests the
// real wiring (the component passes THIS formatter to the tooltip) without a
// test-only prop.
vi.mock("@/components/charts/TouchTooltip", () => ({
  TouchTooltip: ({ formatter }: { formatter: TooltipFormatter }) => {
    captured.formatter = formatter;
    return null;
  },
}));

beforeEach(() => {
  captured.data = [];
  captured.formatter = null;
});
afterEach(cleanup);

/** `n` consecutive UTC days from 2025-01-01. */
function dates(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** A monotone geometric curve of `n` levels from `first` to `last` (inclusive). */
function curve(n: number, first: number, last: number): number[] {
  return Array.from({ length: n }, (_, i) => first * Math.pow(last / first, i / (n - 1)));
}

interface ItemOpts {
  id: string;
  levels: number[];
  cumulativeReturn: number;
  /** `analytics.twr_chain_broken` alias, as the compare read projects it. */
  chainBroken?: string;
  /** `analytics.cumulative_method` alias. */
  method?: "geometric" | "simple";
  headlineCoversFrom?: string | null;
  headlineCoversFromStatus?: "dated" | "undatable" | "read_failed";
}

function item({
  id,
  levels,
  cumulativeReturn,
  chainBroken,
  method,
  headlineCoversFrom,
  headlineCoversFromStatus,
}: ItemOpts) {
  const ds = dates(levels.length);
  return {
    strategy: { id, name: `Strategy ${id}` } as unknown as Strategy,
    analytics: {
      cumulative_return: cumulativeReturn,
      returns_series: levels.map((value, i) => ({ date: ds[i], value })),
      ...(chainBroken === undefined ? {} : { twr_chain_broken: chainBroken }),
      ...(method === undefined ? {} : { cumulative_method: method }),
    } as unknown as StrategyAnalytics,
    ...(headlineCoversFrom === undefined ? {} : { headlineCoversFrom }),
    ...(headlineCoversFromStatus === undefined ? {} : { headlineCoversFromStatus }),
  };
}

function lastPoint(key: string): number {
  for (let i = captured.data.length - 1; i >= 0; i--) {
    const v = captured.data[i][key];
    if (typeof v === "number") return v;
  }
  throw new Error(`no data point for ${key}`);
}

describe("SC-3 tracer: the measured clean strategy ends at its stored +14.54%", () => {
  // The measured PROD shape: 112 stored levels from 0.99998 to 1.1454, stored
  // cumulative_return 0.1454. On HEAD the compounding read ~1e35 percent.
  const levels = curve(112, 0.99998, 1.1454);
  const cumulativeReturn = 0.1454;

  it("plots (level - 1) * 100 from the stored levels, ending at 14.54", () => {
    render(<CompareEquityOverlay items={[item({ id: "a", levels, cumulativeReturn })]} />);
    expect(captured.data).toHaveLength(112);
    expect(lastPoint("s0")).toBeCloseTo(14.54, 2);
    expect(Math.abs(lastPoint("s0") - 14.54)).toBeLessThan(0.005);
  });

  it("formats that last point as the signed tooltip string +14.54%", () => {
    render(<CompareEquityOverlay items={[item({ id: "a", levels, cumulativeReturn })]} />);
    expect(captured.formatter).not.toBeNull();
    const [text, label] = captured.formatter!(lastPoint("s0"), "s0");
    expect(text).toBe("+14.54%");
    expect(label).toBe("Strategy a");
    // Chart and table agree: the table cell prints formatPercent of the stored scalar.
    expect(text).toBe(formatPercent(cumulativeReturn));
  });
});

// ---------------------------------------------------------------------------
// D-07 span, the simple method, and the notes under the legend
// ---------------------------------------------------------------------------

const N = 60;
const DS = dates(N);
const COVERED_FROM = DS[30]; // 2025-01-31

/** Levels with a break: a bridged first stretch, then a new regime from day 30. */
function brokenGeometricLevels(): { levels: number[]; opening: number; cumulativeReturn: number } {
  const levels: number[] = [];
  for (let i = 0; i < 30; i++) levels.push(1 + 0.5 * (i / 29)); // 1.0 -> 1.5 (bridged part)
  const opening = levels[29]; // 1.5, the stored level on the last day before the span
  for (let i = 30; i < N; i++) levels.push(0.9 + 0.3 * ((i - 30) / (N - 31))); // 0.9 -> 1.2
  const last = levels[N - 1];
  return { levels, opening, cumulativeReturn: last / opening - 1 };
}

function brokenSimpleLevels(): { levels: number[]; opening: number; cumulativeReturn: number } {
  const levels: number[] = [];
  for (let i = 0; i < 30; i++) levels.push(1 + 0.3 * (i / 29)); // 1.0 -> 1.3
  const opening = levels[29];
  for (let i = 30; i < N; i++) levels.push(0.95 + 0.2 * ((i - 30) / (N - 31))); // 0.95 -> 1.15
  const last = levels[N - 1];
  return { levels, opening, cumulativeReturn: last - opening };
}

const datesPlotted = (key: string): string[] =>
  captured.data.filter((r) => typeof r[key] === "number").map((r) => String(r.date));

const swatchCount = (container: HTMLElement): number =>
  container.querySelectorAll("span.rounded-sm").length;

const UNDATABLE = (name: string) =>
  `${name}: the span of its cumulative return cannot be dated, so no curve is drawn.`;
const READ_FAILED = (name: string) =>
  `${name}: its measured span could not be loaded, so no curve is drawn.`;
const NO_SERIES = (name: string) => `${name}: no return series yet.`;

describe("D-07: a chain-broken row is drawn over the span its headline return covers", () => {
  it("geometric: plots only days on or after the covered-from date, ending at cumulative_return * 100", () => {
    const { levels, opening, cumulativeReturn } = brokenGeometricLevels();
    render(
      <CompareEquityOverlay
        items={[
          item({
            id: "cb",
            levels,
            cumulativeReturn,
            chainBroken: "true",
            headlineCoversFrom: COVERED_FROM,
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    const plotted = datesPlotted("s0");
    expect(plotted).toHaveLength(N - 30);
    expect(plotted[0]).toBe(COVERED_FROM);
    expect(plotted.every((d) => d >= COVERED_FROM)).toBe(true);
    expect(Math.abs(lastPoint("s0") - cumulativeReturn * 100)).toBeLessThan(1e-9);
    // First point: (level_30 / opening - 1) * 100, with the opening taken from the
    // stored day BEFORE the span (not 1, and not the bridged curve's level).
    expect(captured.data.find((r) => r.date === COVERED_FROM)!.s0).toBeCloseTo(
      (levels[30] / opening - 1) * 100,
      9,
    );
  });

  it("renders Measured since {date} ({name}) with the date as Jan 31, 2025", () => {
    const { levels, cumulativeReturn } = brokenGeometricLevels();
    render(
      <CompareEquityOverlay
        items={[
          item({
            id: "cb",
            levels,
            cumulativeReturn,
            chainBroken: "true",
            headlineCoversFrom: COVERED_FROM,
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    const note = screen.getByText("Measured since Jan 31, 2025 (Strategy cb)");
    expect(note.tagName).toBe("P");
    expect(note.className).toContain("text-caption");
    expect(note.className).toContain("text-text-secondary");
    expect(note.parentElement!.className).toContain("mb-3");
    expect(note.parentElement!.className).toContain("grid");
    expect(note.parentElement!.className).toContain("gap-1");
  });

  it("simple method: points are (level - opening) * 100 and the last equals cumulative_return * 100", () => {
    const { levels, opening, cumulativeReturn } = brokenSimpleLevels();
    render(
      <CompareEquityOverlay
        items={[
          item({
            id: "sm",
            levels,
            cumulativeReturn,
            chainBroken: "true",
            method: "simple",
            headlineCoversFrom: COVERED_FROM,
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    expect(datesPlotted("s0")[0]).toBe(COVERED_FROM);
    expect(captured.data.find((r) => r.date === COVERED_FROM)!.s0).toBeCloseTo(
      (levels[30] - opening) * 100,
      9,
    );
    expect(Math.abs(lastPoint("s0") - cumulativeReturn * 100)).toBeLessThan(1e-9);
  });

  it("a covered-from date on the first stored day plots the whole series as (level - 1) * 100, with no note", () => {
    const levels = curve(40, 1, 1.25);
    render(
      <CompareEquityOverlay
        items={[
          item({
            id: "first",
            levels,
            cumulativeReturn: 0.25,
            chainBroken: "true",
            headlineCoversFrom: dates(40)[0],
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    expect(datesPlotted("s0")).toHaveLength(40);
    expect(lastPoint("s0")).toBeCloseTo(25, 9);
    expect(screen.queryByText(/Measured since/)).toBeNull();
  });

  it("an undatable chain-broken row (degenerate 2.1e6-level curve) draws no line and no swatch, and says why", () => {
    const { container } = render(
      <CompareEquityOverlay
        items={[
          item({
            id: "z",
            levels: curve(40, 2_100_000, 2_200_000),
            cumulativeReturn: 0,
            chainBroken: "true",
            headlineCoversFrom: null,
            headlineCoversFromStatus: "undatable",
          }),
        ]}
      />,
    );
    expect(captured.data).toEqual([]);
    expect(swatchCount(container)).toBe(0);
    expect(screen.getByText(UNDATABLE("Strategy z"))).toBeInTheDocument();
  });

  it("a chain-broken row with no date and no status is treated as undatable, never drawn bridged", () => {
    const { container } = render(
      <CompareEquityOverlay
        items={[
          item({ id: "n", levels: curve(40, 1, 1.4), cumulativeReturn: 0.1, chainBroken: "true" }),
        ]}
      />,
    );
    expect(captured.data).toEqual([]);
    expect(swatchCount(container)).toBe(0);
    expect(screen.getByText(UNDATABLE("Strategy n"))).toBeInTheDocument();
  });

  it("a FAILED covered-from read is its own state: the load-failure note, and NOT the cannot-be-dated note", () => {
    const { container } = render(
      <CompareEquityOverlay
        items={[
          item({
            id: "f",
            levels: curve(40, 1, 1.4),
            cumulativeReturn: 0.1,
            chainBroken: "true",
            headlineCoversFrom: null,
            headlineCoversFromStatus: "read_failed",
          }),
        ]}
      />,
    );
    expect(captured.data).toEqual([]);
    expect(swatchCount(container)).toBe(0);
    expect(screen.getByText(READ_FAILED("Strategy f"))).toBeInTheDocument();
    expect(screen.queryByText(/cannot be dated/)).toBeNull();
  });

  it("a covered-from date after the last stored day cannot be located on the curve: no line, the undatable note", () => {
    render(
      <CompareEquityOverlay
        items={[
          item({
            id: "late",
            levels: curve(40, 1, 1.4),
            cumulativeReturn: 0.1,
            chainBroken: "true",
            headlineCoversFrom: "2099-01-01",
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    expect(captured.data).toEqual([]);
    expect(screen.getByText(UNDATABLE("Strategy late"))).toBeInTheDocument();
  });

  it("a geometric opening level that is not positive cannot be divided by: no line, the undatable note", () => {
    const levels = curve(40, 1, 1.4);
    levels[29] = 0;
    render(
      <CompareEquityOverlay
        items={[
          item({
            id: "zero",
            levels,
            cumulativeReturn: 0.1,
            chainBroken: "true",
            headlineCoversFrom: dates(40)[30],
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    expect(captured.data).toEqual([]);
    expect(screen.getByText(UNDATABLE("Strategy zero"))).toBeInTheDocument();
  });

  it("a headlineCoversFrom on a row that is NOT chain-broken is ignored: the whole series is drawn", () => {
    render(
      <CompareEquityOverlay
        items={[
          item({
            id: "clean",
            levels: curve(40, 1, 1.2),
            cumulativeReturn: 0.2,
            chainBroken: "false",
            headlineCoversFrom: dates(40)[20],
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    expect(datesPlotted("s0")).toHaveLength(40);
    expect(screen.queryByText(/Measured since/)).toBeNull();
  });
});

describe("C-5(b), C-7: a row with nothing to draw is never silently dropped", () => {
  it("no finite level: no line, no swatch, the no-series note", () => {
    const { container } = render(
      <CompareEquityOverlay
        items={[item({ id: "nan", levels: [NaN, NaN, NaN], cumulativeReturn: 0.1 })]}
      />,
    );
    expect(captured.data).toEqual([]);
    expect(swatchCount(container)).toBe(0);
    expect(screen.getByText(NO_SERIES("Strategy nan"))).toBeInTheDocument();
  });

  it("an empty returns_series gets the same note", () => {
    render(<CompareEquityOverlay items={[item({ id: "e", levels: [], cumulativeReturn: 0 })]} />);
    expect(screen.getByText(NO_SERIES("Strategy e"))).toBeInTheDocument();
  });

  it("when no row draws a line, the existing empty copy renders FIRST, then the notes", () => {
    render(
      <CompareEquityOverlay
        items={[
          item({ id: "e", levels: [], cumulativeReturn: 0 }),
          item({
            id: "u",
            levels: curve(10, 1, 1.1),
            cumulativeReturn: 0.1,
            chainBroken: "true",
            headlineCoversFromStatus: "undatable",
          }),
        ]}
      />,
    );
    const empty = screen.getByText("No return series data available for overlay.");
    const noSeries = screen.getByText(NO_SERIES("Strategy e"));
    const undatable = screen.getByText(UNDATABLE("Strategy u"));
    expect(empty.compareDocumentPosition(noSeries) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // legend order: item 0's note before item 1's
    expect(noSeries.compareDocumentPosition(undatable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a non-finite level is dropped from the line: that date is absent, never plotted as 0", () => {
    const levels = curve(20, 1, 1.2);
    levels[10] = NaN;
    render(<CompareEquityOverlay items={[item({ id: "gap", levels, cumulativeReturn: 0.2 })]} />);
    const ds = dates(20);
    const row = captured.data.find((r) => r.date === ds[10]);
    expect(row === undefined || row.s0 === undefined).toBe(true);
    expect(datesPlotted("s0")).toHaveLength(19);
    expect(lastPoint("s0")).toBeCloseTo(20, 9);
  });

  it("nothing renders when there is no note (no empty notes block)", () => {
    const { container } = render(
      <CompareEquityOverlay
        items={[item({ id: "ok", levels: curve(20, 1, 1.2), cumulativeReturn: 0.2 })]}
      />,
    );
    expect(container.querySelector(".grid.gap-1")).toBeNull();
  });

  it("a row that draws keeps its swatch beside a row that does not (legend lists only drawn lines)", () => {
    const { container } = render(
      <CompareEquityOverlay
        items={[
          item({ id: "ok", levels: curve(20, 1, 1.2), cumulativeReturn: 0.2 }),
          item({ id: "e", levels: [], cumulativeReturn: 0 }),
        ]}
      />,
    );
    expect(swatchCount(container)).toBe(1);
    expect(screen.getByText(NO_SERIES("Strategy e"))).toBeInTheDocument();
  });
});

describe("D-07 agreement: the last tooltip string equals the CompareTable Cumulative Return cell", () => {
  it("holds for a clean, a chain-broken geometric and a chain-broken simple row at once", () => {
    const g = brokenGeometricLevels();
    const sm = brokenSimpleLevels();
    const clean = { levels: curve(N, 0.99998, 1.1454), cumulativeReturn: 0.1454 };
    render(
      <CompareEquityOverlay
        items={[
          item({ id: "clean", ...clean }),
          item({
            id: "geo",
            levels: g.levels,
            cumulativeReturn: g.cumulativeReturn,
            chainBroken: "true",
            headlineCoversFrom: COVERED_FROM,
            headlineCoversFromStatus: "dated",
          }),
          item({
            id: "sim",
            levels: sm.levels,
            cumulativeReturn: sm.cumulativeReturn,
            chainBroken: "true",
            method: "simple",
            headlineCoversFrom: COVERED_FROM,
            headlineCoversFromStatus: "dated",
          }),
        ]}
      />,
    );
    const expected: Record<string, number> = {
      s0: clean.cumulativeReturn,
      s1: g.cumulativeReturn,
      s2: sm.cumulativeReturn,
    };
    for (const [key, cumulativeReturn] of Object.entries(expected)) {
      const [text] = captured.formatter!(lastPoint(key), key);
      expect(text).toBe(formatPercent(cumulativeReturn));
    }
  });
});
