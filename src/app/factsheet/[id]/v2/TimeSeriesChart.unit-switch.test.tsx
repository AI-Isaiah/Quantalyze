import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import {
  composeUnitSwitchSentence,
  parseUnitSwitch,
  unitSwitchBaseOnlyFigcaption,
  unitSwitchFigcaption,
  unitSwitchMastheadLine,
  type UnitSegmentsView,
  type UnitSwitchView,
} from "@/lib/factsheet/unit-segments";
import { formatCloseDay } from "@/lib/factsheet/returns-unit";
import { formatDay } from "@/lib/utils";
import { CHART_CONFIGS, type ChartConfig } from "./chart-configs";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

/**
 * Phase 256 (OKXUNITSWITCH) plan 07, UI-SPEC A: a switched strategy's Cumulative Returns chart is
 * one chart with two native segments and a real break.
 *
 * The intent behind each arm: the two units are never joined (two separate paths, no vertex pair
 * between the USD level and 1.00 at x(S)), each segment is compounded in its own unit and every
 * reading names that unit, a window on one side of the switch draws only that side, the comparator
 * stops where the USD line stops, and a payload without a usable switch draws today's chart byte for
 * byte. Pre-fix (origin/main) the same payload draws ONE joined USD line, no marker and no caption.
 *
 * Every day here is synthetic. The expected multiples are compounded in the test from the fixture's
 * own returns, an invariant independent of the chart's helper.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const VB_W = 880;
const lsStore = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
  // jsdom has no layout: a box the size of the viewBox makes a client coordinate equal its viewBox coordinate.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: VB_W, bottom: 280, width: VB_W, height: 280, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const N = 60;
const ALL_DATES = Array.from({ length: N }, (_, i) => addDays("2026-01-01", i));
/** Deterministic USD daily returns with a clear positive drift, so the USD level at S sits well above 1.00. */
const usdReturn = (i: number) => 0.006 + Math.sin(i * 0.7) * 0.01;
const COIN_STEP = 0.012;
const S_IDX = 49;

const PAD_TOP = 20;
const cumulativeCfg = CHART_CONFIGS.find((c) => c.key === "cumulative")!;
const cumVsBenchCfg = CHART_CONFIGS.find((c) => c.key === "cumVsBench")!;

function view(coin = "BTC", sIdx = S_IDX): UnitSwitchView {
  const v = parseUnitSwitch({ coin, last_usd_day: ALL_DATES[sIdx], first_coin_return_day: ALL_DATES[sIdx + 1] });
  expect(v, "the fixture switch must parse").not.toBeNull();
  return v as UnitSwitchView;
}

type Opts = {
  sIdx?: number;
  /** Native coin return of each coin day, in order from S+1; default `COIN_STEP` on every day through the last. */
  coinReturns?: number[];
  /** Days the headline USD series does not carry (a coin day without a stored close). */
  omit?: string[];
  benchmark?: boolean;
  extra?: Record<string, unknown>;
};

function switchedPayload(o: Opts = {}): FactsheetPayload {
  const sIdx = o.sIdx ?? S_IDX;
  const omit = new Set(o.omit ?? []);
  const daily: DailyPoint[] = ALL_DATES.map((date, i) => ({ date, value: usdReturn(i) })).filter((p) => !omit.has(p.date));
  const benchmark: DailyPoint[] | null = o.benchmark
    ? daily.map((p, i) => ({ date: p.date, value: 1 + 0.002 * (i + 1) }))
    : null;
  const base = buildScenarioFactsheetPayload({ portfolioDaily: daily, periodsPerYear: 365, benchmark });
  const coinReturns = o.coinReturns ?? Array.from({ length: N - 1 - sIdx }, () => COIN_STEP);
  const unitSegments: UnitSegmentsView = {
    fromReturns: ALL_DATES.slice(0, sIdx + 1).map((date, i) => ({ date, value: usdReturn(i) })),
    toReturns: coinReturns.map((value, k) => ({ date: ALL_DATES[sIdx + 1 + k], value })),
    baseDay: ALL_DATES[sIdx],
    unpricedDays: [...omit].sort(),
    withheldDays: [],
  };
  return { ...base, unitSwitch: view("BTC", sIdx), unitSegments, ...(o.extra ?? {}) } as unknown as FactsheetPayload;
}

/** The USD cumulative growth through day `i`, compounded from the fixture's own returns. */
const usdCum = (i: number) => Array.from({ length: i + 1 }, (_, k) => 1 + usdReturn(k)).reduce((a, b) => a * b, 1);

let setRange: (r: [number, number]) => void = () => {};
function RangeProbe() {
  const { setXRange } = useXRange();
  useEffect(() => {
    setRange = (r) => setXRange(r);
  }, [setXRange]);
  return null;
}
function SetBasis({ basis }: { basis: Basis }) {
  const { setBasis } = useBasis();
  useEffect(() => {
    setBasis(basis);
  }, [basis, setBasis]);
  return null;
}

function renderChart(payload: FactsheetPayload, config: ChartConfig = cumulativeCfg, basis: Basis = "cash_settlement") {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <SetBasis basis={basis} />
        <RangeProbe />
        <TimeSeriesChart config={config} />
      </BasisProvider>
    </FactsheetProvider>,
  );
}

const ACCENT = 'path[stroke="var(--color-accent)"]';
const MUTED_PATH = 'path[stroke="var(--color-text-muted)"]';
const MARKER = '[data-testid="unit-switch-marker"]';
const SINGLE = '[data-testid="unit-switch-single-code"]';
const NOTE = '[data-testid="unit-switch-note"]';
const SR = '[data-testid="unit-switch-sr"]';

type Vertex = { cmd: string; x: number; y: number };
function vertices(path: Element): Vertex[] {
  const d = path.getAttribute("d") ?? "";
  return [...d.matchAll(/([ML]) (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ cmd: m[1], x: Number(m[2]), y: Number(m[3]) }));
}
const accentPaths = (c: HTMLElement) => [...c.querySelectorAll(ACCENT)];
const near = (a: number, b: number) => Math.abs(a - b) < 0.06;

/** The plot's left edge and width, read from the clip rect the chart draws. */
function plot(c: HTMLElement) {
  const rect = c.querySelector("clipPath rect")!;
  return { left: Number(rect.getAttribute("x")), width: Number(rect.getAttribute("width")) };
}
/** The y of the par (1.00) gridline: the one emphasised line, stroke-width 1.2. */
function parY(c: HTMLElement): number {
  return Number(c.querySelector('line[stroke-width="1.2"]')!.getAttribute("y1"));
}
function xOf(c: HTMLElement, idx: number, range: [number, number] = [0, N - 1]) {
  const { left, width } = plot(c);
  return left + ((idx - range[0]) / (range[1] - range[0])) * width;
}
async function hover(c: HTMLElement, idx: number, range: [number, number] = [0, N - 1]): Promise<string> {
  const svg = c.querySelector("svg")!;
  await act(async () => {
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: xOf(c, idx, range), clientY: 100 });
  });
  return svg.querySelector('text[font-weight="600"]:not([text-anchor])')?.textContent ?? "";
}
async function zoom(range: [number, number]) {
  await act(async () => {
    setRange(range);
  });
}
const text = (c: HTMLElement, sel: string) => c.querySelector(sel)?.textContent ?? null;

// ---------------------------------------------------------------------------------------------
// Task 1 (tracer): two separate paths, a marker, unit codes, the figcaption.
// ---------------------------------------------------------------------------------------------

describe("fixture sanity", () => {
  it("S and S+1 are the fixture's days and the USD level at S is far from 1.00", () => {
    const p = switchedPayload();
    expect(p.unitSwitch?.lastFromDay).toBe(ALL_DATES[S_IDX]);
    expect(p.unitSwitch?.firstToDay).toBe(ALL_DATES[S_IDX + 1]);
    expect(p.dates.length).toBe(N);
    expect(usdCum(S_IDX)).toBeGreaterThan(1.2);
  });
});

describe("TimeSeriesChart unit switch, populated: two native segments and a real break", () => {
  // Pre-fix: origin/main draws one joined USD accent line for this payload, with no marker.
  it("draws the USD and the coin segment as two separate accent paths that meet only in x", () => {
    const { container } = renderChart(switchedPayload());
    const paths = accentPaths(container);
    expect(paths.length).toBe(2);
    const [usd, coin] = paths.map(vertices);

    // Each segment is ONE subpath: a single M, so nothing inside a path lifts and rejoins.
    expect(usd.filter((v) => v.cmd === "M").length).toBe(1);
    expect(coin.filter((v) => v.cmd === "M").length).toBe(1);

    const xS = near(usd[usd.length - 1].x, coin[0].x);
    expect(xS, "the USD path ends at the x where the coin path starts: x(S)").toBe(true);

    // The coin path starts at the 1.00 par line; the USD path ends at the USD level, far from it.
    expect(near(coin[0].y, parY(container))).toBe(true);
    expect(Math.abs(usd[usd.length - 1].y - coin[0].y)).toBeGreaterThan(5);

    // No path holds a vertex pair joining the USD level at x(S) to 1.00 at x(S).
    const xSval = coin[0].x;
    const atS = (vs: Vertex[]) => vs.filter((v) => near(v.x, xSval));
    expect(atS(usd).length, "the USD path has exactly one vertex at x(S)").toBe(1);
    expect(atS(coin).length, "the coin path has exactly one vertex at x(S)").toBe(1);
    expect(near(atS(usd)[0].y, parY(container))).toBe(false);
  });

  it("every path is the strategy accent: both segments use one stroke (colour does not tell them apart)", () => {
    const { container } = renderChart(switchedPayload());
    for (const p of accentPaths(container)) {
      expect(p.getAttribute("stroke")).toBe("var(--color-accent)");
    }
  });

  it("draws one solid secondary marker line at x(S) with the switch sentence as its title, pointer-events none", () => {
    const { container } = renderChart(switchedPayload());
    const groups = container.querySelectorAll(MARKER);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.getAttribute("pointer-events")).toBe("none");
    const lines = g.querySelectorAll("line");
    expect(lines.length).toBe(1);
    expect(lines[0].getAttribute("stroke")).toBe("var(--color-text-secondary)");
    expect(lines[0].hasAttribute("stroke-dasharray")).toBe(false);
    expect(near(Number(lines[0].getAttribute("x1")), xOf(container, S_IDX))).toBe(true);
    expect(g.querySelector("title")?.textContent).toBe(unitSwitchMastheadLine(view()));
  });

  it("labels USD left and BTC right of the marker, 4 away, on the PAD.top + 37 row, in the marks-start label idiom", () => {
    const { container } = renderChart(switchedPayload());
    const texts = [...container.querySelectorAll(`${MARKER} text`)];
    const usd = texts.find((t) => t.textContent === "USD")!;
    const btc = texts.find((t) => t.textContent === "BTC")!;
    const xS = xOf(container, S_IDX);
    expect(usd.getAttribute("text-anchor")).toBe("end");
    expect(near(Number(usd.getAttribute("x")), xS - 4)).toBe(true);
    expect(Number(usd.getAttribute("y"))).toBe(PAD_TOP + 37);
    expect(btc.getAttribute("text-anchor")).toBe("start");
    expect(near(Number(btc.getAttribute("x")), xS + 4)).toBe(true);
    expect(Number(btc.getAttribute("y"))).toBe(PAD_TOP + 37);
    for (const t of [usd, btc]) {
      expect(t.getAttribute("font-size")).toBe("10");
      expect(t.getAttribute("font-family")).toBe("var(--font-mono)");
      expect(t.getAttribute("letter-spacing")).toBe("0.05em");
      expect(t.getAttribute("fill")).toBe("var(--color-text-secondary)");
    }
  });

  it("prints the figcaption (HTML, so it prints) and an sr-only sentence before the plot", () => {
    const { container } = renderChart(switchedPayload());
    const note = container.querySelector(NOTE)!;
    expect(note.tagName).toBe("FIGCAPTION");
    expect(note.className).toBe("text-caption text-text-secondary");
    expect(note.textContent).toBe(unitSwitchFigcaption(view(), { comparatorActive: false }));
    expect(note.textContent).toContain(`In USD to ${formatCloseDay(ALL_DATES[S_IDX])}, in BTC from ${formatCloseDay(ALL_DATES[S_IDX + 1])}`);

    const sr = container.querySelector(SR)!;
    expect(sr.className).toBe("sr-only");
    expect(sr.textContent).toBe(`${composeUnitSwitchSentence(view())}. The chart draws two separate lines; the BTC line starts again at 1.00×.`);
    // Before the plot: the sentence precedes the svg in document order.
    const svg = container.querySelector("svg")!;
    expect(sr.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a second fixture (another coin, other days) draws its own labels: no unit or day is a literal", () => {
    const sIdx = 30;
    const payload = switchedPayload({ sIdx });
    const eth = { ...(payload.unitSwitch as UnitSwitchView), toUnit: "ETH" };
    const segs = payload.unitSegments as UnitSegmentsView;
    const { container } = renderChart({ ...payload, unitSwitch: eth, unitSegments: { ...segs } } as FactsheetPayload);
    const labels = [...container.querySelectorAll(`${MARKER} text`)].map((t) => t.textContent);
    expect(labels).toEqual(["USD", "ETH"]);
    expect(text(container, NOTE)).toContain(formatCloseDay(ALL_DATES[sIdx]));
  });

  it("the other curves draw the headline series unbroken: Cumulative vs Benchmark is byte-identical to an unswitched payload", () => {
    const withSwitch = renderChart(switchedPayload({ benchmark: true }), cumVsBenchCfg);
    const html = withSwitch.container.innerHTML;
    cleanup();
    const plain = switchedPayload({ benchmark: true }) as unknown as Record<string, unknown>;
    delete plain.unitSwitch;
    delete plain.unitSegments;
    expect(renderChart(plain as unknown as FactsheetPayload, cumVsBenchCfg).container.innerHTML).toBe(html);
    expect(html).not.toContain("unit-switch");
  });
});

describe("TimeSeriesChart unit switch, error: a malformed or absent switch draws today's chart byte for byte", () => {
  // Pre-fix: trivially true (nothing reads the fields); the arm pins that the gate never half-draws.
  it("unitSwitch alone, unitSegments alone and neither render the same markup as an unswitched payload, with no marker or figcaption", () => {
    const full = switchedPayload() as unknown as Record<string, unknown>;
    const plain = { ...full };
    delete plain.unitSwitch;
    delete plain.unitSegments;
    const onlySwitch = { ...plain, unitSwitch: full.unitSwitch };
    const onlySegments = { ...plain, unitSegments: full.unitSegments };

    const htmlPlain = renderChart(plain as unknown as FactsheetPayload).container.innerHTML;
    cleanup();
    const htmlSwitchOnly = renderChart(onlySwitch as unknown as FactsheetPayload).container.innerHTML;
    cleanup();
    const htmlSegmentsOnly = renderChart(onlySegments as unknown as FactsheetPayload).container.innerHTML;
    expect(htmlSwitchOnly).toBe(htmlPlain);
    expect(htmlSegmentsOnly).toBe(htmlPlain);
    expect(htmlPlain).not.toContain("unit-switch");
  });

  it("a coin segment of non-array returns draws the single series (a cached payload cannot crash the chart)", () => {
    const p = switchedPayload();
    const broken = { ...p, unitSegments: { ...(p.unitSegments as UnitSegmentsView), toReturns: null } } as unknown as FactsheetPayload;
    const { container } = renderChart(broken);
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();
    expect(accentPaths(container).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2: states, zoom, hover, comparator stop, unpriced coin day, overflow, basis.
// ---------------------------------------------------------------------------------------------

describe("TimeSeriesChart unit switch, partial: the coin segment holds only its base", () => {
  // Pre-fix: origin/main draws one USD line and no caption.
  it("draws the USD path alone, no marker and no code, and the figcaption says no BTC day is in the record yet", () => {
    const { container } = renderChart(switchedPayload({ coinReturns: [] }));
    expect(accentPaths(container).length).toBe(1);
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(SINGLE)).toBeNull();
    expect(text(container, NOTE)).toBe(unitSwitchBaseOnlyFigcaption(view()));
    expect(text(container, NOTE)).toContain("No BTC day is in the record yet.");
    expect(container.querySelector(SR)).toBeNull();
  });
});

describe("TimeSeriesChart unit switch, partial: a zoom window wholly on one side of the switch", () => {
  // Pre-fix: origin/main draws its one USD line over every window, with no code and no caption.
  it("a window wholly in the coin segment draws the coin path only, rebased at the window start, with one BTC code top-left and the figcaption", async () => {
    const { container } = renderChart(switchedPayload());
    await zoom([52, N - 1]);
    expect(accentPaths(container).length).toBe(1);
    expect(container.querySelector(MARKER)).toBeNull();
    const code = container.querySelector(`${SINGLE} text`)!;
    expect(code.textContent).toBe("BTC");
    expect(Number(code.getAttribute("x"))).toBe(plot(container).left + 4);
    expect(Number(code.getAttribute("y"))).toBe(PAD_TOP + 37);
    expect(code.getAttribute("text-anchor")).toBe("start");
    expect(container.querySelector(NOTE)).not.toBeNull();
    // Rebased at the window start: the coin path opens on the par line.
    const coin = vertices(accentPaths(container)[0]);
    expect(near(coin.find((v) => v.x >= plot(container).left - 0.06)!.y, parY(container))).toBe(true);
    // The reading at the last day is the growth since the window start, in the coin.
    expect(await hover(container, N - 1, [52, N - 1])).toContain(`${((1 + COIN_STEP) ** (N - 1 - 52)).toFixed(2)}× in BTC`);
  });

  it("a window wholly in the USD segment draws the USD path only with one USD code top-left and the figcaption", async () => {
    const { container } = renderChart(switchedPayload());
    await zoom([5, 45]);
    expect(accentPaths(container).length).toBe(1);
    expect(container.querySelector(MARKER)).toBeNull();
    expect(text(container, `${SINGLE} text`)).toBe("USD");
    expect(container.querySelector(NOTE)).not.toBeNull();
  });

  it("a window starting inside the USD segment rebases only the USD part; the coin part keeps its own base", async () => {
    const { container } = renderChart(switchedPayload());
    const range: [number, number] = [20, N - 1];
    await zoom(range);
    expect(accentPaths(container).length).toBe(2);
    expect(container.querySelector(MARKER)).not.toBeNull();
    // USD rebased at day 20: its reading at day 30 is the growth from day 20 to day 30.
    expect(await hover(container, 30, range)).toContain(`${(usdCum(30) / usdCum(20)).toFixed(2)}× in USD`);
    // The coin part is NOT divided by anything: its last day reads the native 10-day growth.
    expect(await hover(container, N - 1, range)).toContain(`${((1 + COIN_STEP) ** (N - 1 - S_IDX)).toFixed(2)}× in BTC`);
  });
});

describe("TimeSeriesChart unit switch, interaction: the hover reads each segment in its own unit", () => {
  // Pre-fix: origin/main's tooltip reads a percent row with no unit.
  it("a coin day reads '{date} · {growth}× in BTC' and a USD day '… in USD', each compounded in its own unit", async () => {
    const { container } = renderChart(switchedPayload());
    const coinDay = 55;
    expect(await hover(container, coinDay)).toBe(
      `${formatDay(ALL_DATES[coinDay])} · ${((1 + COIN_STEP) ** (coinDay - S_IDX)).toFixed(2)}× in BTC`,
    );
    expect(await hover(container, 10)).toBe(`${formatDay(ALL_DATES[10])} · ${usdCum(10).toFixed(2)}× in USD`);
  });

  it("the base vertex at x(S) reads the USD point, and only one dot is drawn there", async () => {
    const { container } = renderChart(switchedPayload());
    expect(await hover(container, S_IDX)).toBe(`${formatDay(ALL_DATES[S_IDX])} · ${usdCum(S_IDX).toFixed(2)}× in USD`);
    // The coin base vertex (1.00 at x(S)) is drawn but not hoverable: no second dot, no coin reading.
    expect(container.querySelectorAll("svg circle").length).toBe(1);
  });
});

describe("TimeSeriesChart unit switch, comparator: stops at the last USD day", () => {
  // Pre-fix: origin/main draws the comparator across the whole axis.
  it("the comparator path ends at x(S) and the figcaption names the stop", () => {
    const { container } = renderChart(switchedPayload({ benchmark: true }));
    const cmp = container.querySelector(MUTED_PATH);
    expect(cmp, "the comparator is drawn").not.toBeNull();
    const last = vertices(cmp!).at(-1)!;
    expect(near(last.x, xOf(container, S_IDX))).toBe(true);
    const sentence = text(container, NOTE)!;
    expect(sentence.endsWith(`The comparator is shown to ${formatCloseDay(ALL_DATES[S_IDX])}.`)).toBe(true);
    expect(sentence).toBe(unitSwitchFigcaption(view(), { comparatorActive: true }));
  });

  it("without a comparator the figcaption carries no comparator clause", () => {
    const { container } = renderChart(switchedPayload());
    expect(text(container, NOTE)).not.toContain("comparator");
  });
});

describe("TimeSeriesChart unit switch, partial: a coin-segment day without a stored close", () => {
  const UNPRICED = ALL_DATES[53];
  // The coin's native return on the unpriced day is large, so dropping it would be visible.
  const coinReturns = Array.from({ length: N - 1 - S_IDX }, (_, k) => (S_IDX + 1 + k === 53 ? 0.05 : COIN_STEP));

  // Pre-fix: origin/main has no native coin line at all, so the day has no carrier but the headline gap.
  it("draws the native coin path and compounds the unpriced day's native return into the next plotted point", async () => {
    const payload = switchedPayload({ omit: [UNPRICED], coinReturns });
    const { container } = renderChart(payload);
    const coin = accentPaths(container)[1];
    expect(vertices(coin).filter((v) => v.cmd === "M").length, "no seam inside the coin line").toBe(1);
    // The next plotted day after the unpriced one is index 53 on the 59-day headline axis.
    const next = payload.dates.indexOf(ALL_DATES[54]);
    const expected = coinReturns.slice(0, 54 - S_IDX).reduce((a, r) => a * (1 + r), 1);
    expect(await hover(container, next, [0, payload.dates.length - 1])).toContain(`${expected.toFixed(2)}× in BTC`);
    expect(expected.toFixed(2)).not.toBe(((1 + COIN_STEP) ** (54 - S_IDX)).toFixed(2));
  });

  it("a headline gap run inside the coin segment draws no 'no data' seam; one inside the USD segment draws as today", () => {
    const inCoin = switchedPayload({
      omit: [UNPRICED],
      coinReturns,
      extra: { missingSegments: [{ start: UNPRICED, end: UNPRICED, days: 1 }] },
    });
    expect(renderChart(inCoin).container.textContent).not.toContain("no data");
    cleanup();
    const inUsd = switchedPayload({
      extra: { missingSegments: [{ start: ALL_DATES[20], end: ALL_DATES[20], days: 1 }] },
    });
    expect(renderChart(inUsd).container.textContent).toContain("1d — no data");
  });
});

describe("TimeSeriesChart unit switch, overflow: the coin label near the plot's right edge", () => {
  // Pre-fix: origin/main draws no label to flip.
  it("flips to end-anchored at x(S) - 4 on the PAD.top + 50 row when it would cross the right edge, and clips nothing", () => {
    const sIdx = N - 2;
    const { container } = renderChart(switchedPayload({ sIdx }));
    const texts = [...container.querySelectorAll(`${MARKER} text`)];
    const usd = texts.find((t) => t.textContent === "USD")!;
    const btc = texts.find((t) => t.textContent === "BTC")!;
    const xS = xOf(container, sIdx);
    expect(btc.getAttribute("text-anchor")).toBe("end");
    expect(near(Number(btc.getAttribute("x")), xS - 4)).toBe(true);
    expect(Number(btc.getAttribute("y"))).toBe(PAD_TOP + 50);
    // The two codes stack left of the marker, USD above BTC.
    expect(near(Number(usd.getAttribute("x")), xS - 4)).toBe(true);
    expect(Number(usd.getAttribute("y"))).toBe(PAD_TOP + 37);
  });
});

describe("TimeSeriesChart unit switch, interaction: basis", () => {
  // Pre-fix: origin/main draws the single series on every basis.
  it("draws the native segments on the cash basis, and today's single series when a non-cash bundle is the one drawn", () => {
    const bundle = deriveSeriesBundle(
      ALL_DATES.map((date, i) => ({ date, value: usdReturn(i) * 1.1 })),
      {
        periodsPerYear: 365,
        isArithmetic: false,
        markets: [],
        strategyName: "Synthetic",
        benchmarkPrices: { unavailable: true },
        figureRecord: null,
      },
    );
    const withMtm = { ...switchedPayload(), seriesByBasis: { mark_to_market: bundle } } as unknown as FactsheetPayload;

    const cash = renderChart(withMtm, cumulativeCfg, "cash_settlement");
    expect(cash.container.querySelector(MARKER)).not.toBeNull();
    cleanup();

    const mtm = renderChart(withMtm, cumulativeCfg, "mark_to_market");
    expect(mtm.container.querySelector(MARKER)).toBeNull();
    expect(mtm.container.querySelector(NOTE)).toBeNull();
    expect(accentPaths(mtm.container).length).toBe(1);
    cleanup();

    // The selected basis falling back to cash (its bundle absent) is cash being drawn.
    const fallback = renderChart(switchedPayload(), cumulativeCfg, "mark_to_market");
    expect(fallback.container.querySelector(MARKER)).not.toBeNull();
  });
});
