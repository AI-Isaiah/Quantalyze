/** @vitest-environment jsdom */
/**
 * Phase 237 FACT-01 plan 09 (CONTEXT "Follow-ons of the FACT-01 ruling", UI-SPEC 1.6): the
 * figures a withheld rail panel hides are withheld wherever else they render on the same
 * Withheld full-history view. Four secondary renderings:
 *
 *   1. the End-of-Year Returns bar chart (value labels, bars, scale): note by cause,
 *   2. the Monthly Returns heatmap's YTD column: a dash on EVERY row,
 *   3. the Worst 10 Drawdown Periods chart (bands and depth labels): note by cause,
 *   4. the rolling charts' hover note: the strategy row's value at the LAST index.
 *
 * The sentences are HAND-TYPED here (UI-SPEC FH237-PANEL-WITHHELD and FH237-PANEL-RECOMPUTING),
 * never imported, so a change to the source copy fails here by name.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider, useXRange } from "./factsheet-context";
import { EndOfYearBarsPanel } from "./DistributionPanels";
import { FactsheetBody } from "./FactsheetView";
import { formatDay } from "@/lib/utils";

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      lsStore.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      lsStore.delete(k);
    }),
    clear: vi.fn(() => lsStore.clear()),
    key: vi.fn(() => null),
    length: 0,
  });
});

const SINCE = "2026-04-18";
const R3 =
  "a zero or negative account balance, a near-zero account balance and a one-day gain or loss larger than the balance";
const ALL_THREE = ["negative_nav", "dust_nav", "pnl_dominated"] as const;

/** UI-SPEC FH237-PANEL-WITHHELD, with {R} filled from the three guard reasons. HAND-TYPED. */
const PANEL_WITHHELD = `⚠ Withheld: this panel covers earlier history, which is unreliable (it includes ${R3}), and the span after it has not been measured yet.`;
/** UI-SPEC FH237-PANEL-RECOMPUTING. HAND-TYPED. */
const PANEL_RECOMPUTING = "⚠ Withheld while the headline figures are recomputed.";
/** Phase 252 DERIBITOPTIONS: the options panel sentence, muted and with NO glyph. HAND-TYPED. */
const PANEL_OPTIONS =
  "Withheld: this panel is measured on the cash wallet, which leaves out the market value of open option positions.";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
function dense(n: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01,
  }));
}
const META = {
  id: "withheld-renderings-test",
  name: "Withheld Renderings Test",
  types: ["test"],
  markets: ["crypto"],
  computedAt: "2026-09-29T00:00:00Z",
  trustTier: null,
  ingestSource: "csv" as const,
};

type DQ = NonNullable<FactsheetPayload["dataQuality"]>;
const DATED: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineCoversFrom: SINCE,
  headlineGuardReasons: [...ALL_THREE],
};
const WITHHELD_DQ: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineWithheld: true,
  headlineGuardReasons: [...ALL_THREE],
};
const RECOMPUTING_DQ: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "recomputing" };
const FAILED_DQ: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "failed" };
const CLEAN: DQ = { composite: false, insufficientWindow: false };
/** Phase 252: the options-book cause on an INTACT chain (no `twrChainBroken`, no guard reasons). */
const OPTIONS_DQ: DQ = { composite: true, headlineWithheld: true, headlineWithheldCause: "options_cash_wallet" };

/** A comparator selected (the fixture BTC leg), so the EOY chart draws its benchmark bars too. */
function payloadWithComparator(dataQuality: FactsheetPayload["dataQuality"]): FactsheetPayload {
  const built = buildFactsheetPayload(META, dense(400));
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return { ...built, periodsPerYear: 365, dataQuality, activeComparator: "btc" } as FactsheetPayload;
}

/** The Withheld payload as the read path builds it: the seven scalars and the windows nulled. */
function asBuilt(dq: DQ, overrides?: (p: FactsheetPayload) => Partial<FactsheetPayload["strategyMetrics"]>): FactsheetPayload {
  const base = payloadWithComparator(dq);
  const built = {
    ...base,
    strategyMetrics: {
      ...base.strategyMetrics,
      cum_ret: NaN,
      cagr: NaN,
      sharpe: NaN,
      sortino: NaN,
      calmar: NaN,
      max_dd: NaN,
      ann_vol: NaN,
    },
  } as FactsheetPayload;
  return {
    ...built,
    strategyMetrics: {
      ...built.strategyMetrics,
      mtd: null,
      ytd: null,
      p3m: null,
      p6m: null,
      p1y: null,
      p3y: null,
      p5y: null,
      ...(overrides ? overrides(built) : {}),
    },
  } as FactsheetPayload;
}
const lastYearOf = (p: FactsheetPayload) => p.dates[p.dates.length - 1].slice(0, 4);

const SNAPSHOT_TIMEOUT_MS = 120_000;

function figureTitled(container: HTMLElement, title: string): HTMLElement | null {
  const hits = [...container.querySelectorAll<HTMLElement>("figure")].filter((f) =>
    (f.querySelector("h3")?.textContent ?? "").trim().startsWith(title),
  );
  if (hits.length > 1) throw new Error(`${hits.length} figures titled "${title}"`);
  return hits[0] ?? null;
}
function mustFigure(container: HTMLElement, title: string): HTMLElement {
  const f = figureTitled(container, title);
  if (!f) throw new Error(`no figure titled "${title}"`);
  return f;
}

/** Mounts the whole body (optionally zoomed) and flushes the next/dynamic loaders. */
async function mountBody(payload: FactsheetPayload, zoom?: [number, number]) {
  function Zoom({ range }: { range: [number, number] }) {
    const { setXRange } = useXRange();
    return (
      <button data-testid="zoom" onClick={() => setXRange(range)}>
        zoom
      </button>
    );
  }
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      {zoom && <Zoom range={zoom} />}
      <FactsheetBody payload={payload} hideFooter />
    </FactsheetProvider>,
  );
  if (zoom) {
    await act(async () => {
      fireEvent.click(view.container.querySelector('[data-testid="zoom"]')!);
    });
  }
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return view;
}

/* -------------------------------------------------------------------------- */
/* 1. End-of-Year Returns bar chart                                            */
/* -------------------------------------------------------------------------- */

describe("the End-of-Year Returns bar chart on a Withheld full-history view (FACT-01 follow-on, UI-SPEC 1.6 row 1)", () => {
  function renderEoy(payload: FactsheetPayload, fullHistoryWithheld: boolean) {
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <EndOfYearBarsPanel fullHistoryWithheld={fullHistoryWithheld} />
      </FactsheetProvider>,
    );
  }
  const notesIn = (fig: HTMLElement) => [...fig.querySelectorAll<HTMLElement>('[data-testid="chart-withheld-note"]')];

  it("keeps the title and replaces everything else with one note: no svg, no subtitle, no bar label, no legend", () => {
    // Premise: the same chart, gate off, draws an svg, a scale subtitle and percent labels.
    const open = renderEoy(payloadWithComparator(CLEAN), false);
    const openFig = mustFigure(open.container, "End-of-Year Returns");
    expect(openFig.querySelector('svg[role="img"]'), "premise: the open chart draws its svg").not.toBeNull();
    expect(openFig.textContent, "premise: the open chart prints a scale").toContain("scale ±");
    expect(openFig.textContent, "premise: the open chart prints percent labels").toMatch(/\d%/);
    open.unmount();

    const { container } = renderEoy(asBuilt(WITHHELD_DQ), true);
    const fig = mustFigure(container, "End-of-Year Returns");
    expect(fig.querySelector("h3")?.textContent).toBe("End-of-Year Returns vs BTC");
    const notes = notesIn(fig);
    expect(notes).toHaveLength(1);
    expect(notes[0].tagName).toBe("P");
    expect((notes[0].textContent ?? "").trim()).toBe(PANEL_WITHHELD);
    expect(notes[0].className).toContain("text-fixed-10");
    expect(notes[0].className).toContain("italic");
    expect(fig.querySelector("svg"), "no svg frame").toBeNull();
    expect(fig.querySelector("header p"), "no scale subtitle").toBeNull();
    expect(fig.textContent, "no scale text").not.toContain("scale ±");
    expect(fig.textContent, "no percent figure anywhere in the figure").not.toMatch(/\d%/);
    expect(fig.querySelector("[title]"), "no title attribute can carry a figure").toBeNull();
    expect(fig.querySelector("[aria-label]"), "no aria-label can carry a figure").toBeNull();
  });

  it("recomputing cause: the FH237-PANEL-RECOMPUTING sentence under the title", () => {
    const { container } = renderEoy(asBuilt(RECOMPUTING_DQ), true);
    const fig = mustFigure(container, "End-of-Year Returns");
    const notes = notesIn(fig);
    expect(notes).toHaveLength(1);
    expect((notes[0].textContent ?? "").trim()).toBe(PANEL_RECOMPUTING);
    expect(fig.querySelector("svg")).toBeNull();
  });

  it("failed cause: the figure is absent (the page already states the analytics failed)", () => {
    const { container } = renderEoy(asBuilt(FAILED_DQ), true);
    expect(figureTitled(container, "End-of-Year Returns")).toBeNull();
    expect(container.querySelector('[data-testid="chart-withheld-note"]')).toBeNull();
  });

  it("a Dated row (gate off) draws bars and labels for every year", () => {
    const payload = asBuilt(DATED);
    const { container } = renderEoy(payload, false);
    const fig = mustFigure(container, "End-of-Year Returns");
    expect(notesIn(fig)).toHaveLength(0);
    const years = Object.keys(payload.strategyMetrics.yearly);
    expect(years.length, "premise: more than one year").toBeGreaterThan(1);
    for (const y of years) {
      const g = [...fig.querySelectorAll("g")].find((n) => n.querySelector(":scope > text")?.textContent === y);
      expect(g, `a row for ${y}`).toBeDefined();
      expect([...g!.querySelectorAll("text")].length, `${y} keeps its labels`).toBeGreaterThanOrEqual(2);
      expect(g!.querySelectorAll("rect").length, `${y} keeps its bars`).toBeGreaterThan(0);
    }
  });

  it("whole body: a Withheld full-history row carries the note, with and without a range", async () => {
    for (const zoom of [undefined, [10, 300] as [number, number]]) {
      const w = await mountBody(asBuilt(WITHHELD_DQ), zoom);
      const fig = mustFigure(w.container, "End-of-Year Returns");
      expect(notesIn(fig), `zoom=${String(zoom)}`).toHaveLength(1);
      expect(fig.querySelector("svg")).toBeNull();
      expect(fig.textContent).not.toMatch(/\d%/);
      w.unmount();
    }
  }, SNAPSHOT_TIMEOUT_MS);

  it("whole body: the failed cause leaves no End-of-Year Returns chart at all", async () => {
    const w = await mountBody(asBuilt(FAILED_DQ));
    expect(figureTitled(w.container, "End-of-Year Returns")).toBeNull();
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("whole body: a last year set far above the rest (+900%) reaches neither a label nor a scale", async () => {
    const base = payloadWithComparator(WITHHELD_DQ);
    const year = lastYearOf(base);
    const w = await mountBody(asBuilt(WITHHELD_DQ, (p) => ({ yearly: { ...p.strategyMetrics.yearly, [year]: 9 } })));
    const fig = mustFigure(w.container, "End-of-Year Returns");
    expect(fig.textContent).not.toContain("900");
    expect(fig.textContent).not.toMatch(/\d%/);
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);
});

/* -------------------------------------------------------------------------- */
/* 2. Monthly Returns heatmap, YTD column                                      */
/* -------------------------------------------------------------------------- */

describe("the Monthly Returns heatmap's YTD column on a Withheld full-history view (UI-SPEC 1.6 row 2)", () => {
  /** Every row of the heatmap as extracted strings, so no element reference is held across a render. */
  function heatmapRows(container: HTMLElement) {
    const fig = mustFigure(container, "Monthly Returns");
    return [...fig.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((tr) => {
      const tds = [...tr.querySelectorAll("td")];
      const ytd = tds[tds.length - 1];
      return {
        year: (tds[0].textContent ?? "").trim(),
        ytd: (ytd.textContent ?? "").trim(),
        ytdStyle: ytd.getAttribute("style") ?? "",
        ytdTitle: ytd.getAttribute("title"),
        ytdTestId: ytd.getAttribute("data-testid"),
        months: tds.slice(1, -1).map((td) => (td.textContent ?? "").trim()),
        monthTitles: tds.slice(1, -1).map((td) => td.getAttribute("title") ?? ""),
      };
    });
  }

  for (const [label, zoom] of [
    ["at full history", undefined],
    ["inside a range", [10, 300] as [number, number]],
  ] as const) {
    it(`${label}: every row's YTD cell reads the dash, untoned and untitled, and the dashed count equals the year count`, async () => {
      const clean = await mountBody(payloadWithComparator(CLEAN), zoom);
      const cleanRows = heatmapRows(clean.container);
      expect(cleanRows.length, "premise: more than one year row").toBeGreaterThan(1);
      for (const r of cleanRows) {
        expect(r.ytd, `premise: a clean ${r.year} row prints its YTD`).toMatch(/\d/);
        expect(r.ytdStyle, `premise: a clean ${r.year} YTD carries a tone`).toMatch(/--color-(positive|negative)/);
      }
      clean.unmount();

      const w = await mountBody(asBuilt(WITHHELD_DQ), zoom);
      const rows = heatmapRows(w.container);
      expect(rows.map((r) => r.year)).toEqual(cleanRows.map((r) => r.year));
      expect(
        w.container.querySelectorAll('[data-testid="heatmap-ytd-withheld"]'),
        "the dashed YTD count equals the year count",
      ).toHaveLength(rows.length);
      rows.forEach((r, i) => {
        expect(r.ytd, `${r.year} YTD`).toBe("—");
        expect(r.ytdTestId, `${r.year} YTD testid`).toBe("heatmap-ytd-withheld");
        expect(r.ytdStyle, `${r.year} YTD carries no tone`).not.toMatch(/--color-(positive|negative)/);
        expect(r.ytdTitle, `${r.year} YTD carries no title`).toBeNull();
        // Every month cell keeps its figure, except the last row's last month with data, which keeps
        // its existing withheld treatment (the Month-to-date figure the Returns panel dashes).
        const lastIdx = cleanRows[i].months.map((t) => t !== "·").lastIndexOf(true);
        const isLastRow = i === rows.length - 1;
        expect(
          r.months.filter((_, m) => !(isLastRow && m === lastIdx)),
          `${r.year} month cells keep their figures`,
        ).toEqual(cleanRows[i].months.filter((_, m) => !(isLastRow && m === lastIdx)));
        if (isLastRow) expect(r.months[lastIdx], "the last month cell keeps its withheld treatment").toBe("—");
      });
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);
  }

  it("every cause dashes, the failed cause included", async () => {
    for (const dq of [RECOMPUTING_DQ, FAILED_DQ]) {
      const w = await mountBody(asBuilt(dq));
      const rows = heatmapRows(w.container);
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.every((r) => r.ytd === "—" && r.ytdTestId === "heatmap-ytd-withheld")).toBe(true);
      w.unmount();
    }
  }, SNAPSHOT_TIMEOUT_MS);

  it("a Dated row has no dashed YTD cell", async () => {
    const d = await mountBody(asBuilt(DATED));
    expect(d.container.querySelectorAll('[data-testid="heatmap-ytd-withheld"]')).toHaveLength(0);
    for (const r of heatmapRows(d.container)) expect(r.ytd).toMatch(/\d/);
    d.unmount();
  }, SNAPSHOT_TIMEOUT_MS);
});

/* -------------------------------------------------------------------------- */
/* 3. Worst 10 Drawdown Periods chart                                          */
/* -------------------------------------------------------------------------- */

describe("the Worst 10 Drawdown Periods chart on a Withheld full-history view (UI-SPEC 1.6 row 3)", () => {
  const TITLE = "Worst 10 Drawdown Periods";
  /** The rail's own table rows under its "Worst 10 Drawdowns" header. */
  function railRows(container: HTMLElement): number {
    const sections = [...container.querySelectorAll<HTMLElement>("section")].filter(
      (sec) => (sec.querySelector(":scope > header h3")?.textContent ?? "").trim() === "Worst 10 Drawdowns",
    );
    return sections.reduce((n, sec) => n + sec.querySelectorAll("tbody tr").length, 0);
  }
  const bandLabels = (fig: HTMLElement) =>
    [...fig.querySelectorAll("svg text")].map((t) => (t.textContent ?? "").trim()).filter((t) => /^#\d+\s/.test(t));

  it("a Dated row draws bands and #n depth labels (premise)", async () => {
    const d = await mountBody(asBuilt(DATED));
    const fig = mustFigure(d.container, TITLE);
    expect(fig.querySelector('[data-testid="chart-withheld-note"]')).toBeNull();
    expect(fig.querySelector("svg")).not.toBeNull();
    expect(fig.querySelectorAll("svg rect").length, "bands draw").toBeGreaterThan(0);
    expect(bandLabels(fig).length, "#n labels draw").toBeGreaterThan(0);
    d.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  for (const [label, zoom] of [
    ["at full history", undefined],
    ["inside a range (its bands are whole-record even when zoomed)", [10, 300] as [number, number]],
  ] as const) {
    it(`${label}: the title and one note, no subtitle, frame, bands, depth labels or crosshair; the rail table keeps its slice in a range`, async () => {
      const w = await mountBody(asBuilt(WITHHELD_DQ), zoom);
      const fig = mustFigure(w.container, TITLE);
      expect(fig.querySelector("h3")?.textContent).toBe(TITLE);
      const notes = fig.querySelectorAll('[data-testid="chart-withheld-note"]');
      expect(notes).toHaveLength(1);
      expect((notes[0].textContent ?? "").trim()).toBe(PANEL_WITHHELD);
      expect(fig.querySelector("svg"), "no svg frame").toBeNull();
      expect(fig.querySelector("header p"), "no subtitle").toBeNull();
      expect(bandLabels(fig), "no depth label").toEqual([]);
      expect(fig.textContent, "no percent figure").not.toMatch(/\d%/);
      expect(fig.querySelector("button"), "no scale tabs, legend chip or export menu").toBeNull();
      if (zoom) {
        expect(railRows(w.container), "inside a range the Worst 10 TABLE shows its slice").toBeGreaterThan(0);
      } else {
        expect(railRows(w.container), "at full history the rail table is withheld too").toBe(0);
      }
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);
  }

  it("recomputing cause: the FH237-PANEL-RECOMPUTING sentence", async () => {
    const w = await mountBody(asBuilt(RECOMPUTING_DQ));
    const fig = mustFigure(w.container, TITLE);
    expect((fig.querySelector('[data-testid="chart-withheld-note"]')?.textContent ?? "").trim()).toBe(PANEL_RECOMPUTING);
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("failed cause: the chart is absent, at full history and inside a range", async () => {
    for (const zoom of [undefined, [10, 300] as [number, number]]) {
      const w = await mountBody(asBuilt(FAILED_DQ), zoom);
      expect(figureTitled(w.container, TITLE), `zoom=${String(zoom)}`).toBeNull();
      w.unmount();
    }
  }, SNAPSHOT_TIMEOUT_MS);
});

/* -------------------------------------------------------------------------- */
/* 4. Rolling charts' hover note                                               */
/* -------------------------------------------------------------------------- */

describe("the rolling charts' hover note at the last point on a Withheld full-history view (UI-SPEC 1.6 row 4)", () => {
  const ROLLING = ["Rolling Volatility", "Rolling Sharpe", "Rolling Sortino"];
  // The tooltip truncates a series name to 18 characters.
  const STRATEGY_PREFIX = "Withheld Renderin";

  function chartSvg(container: HTMLElement, title: string): SVGSVGElement {
    const svg = [...container.querySelectorAll<SVGSVGElement>("svg")].find((n) =>
      (n.getAttribute("aria-label") ?? "").startsWith(title),
    );
    if (!svg) throw new Error(`no chart svg for ${title}`);
    return svg;
  }
  /** Hover the chart at viewBox x = `vbx` (the mocked rect maps 1 client px to 1 viewBox unit). */
  async function hover(svg: SVGSVGElement, vbx: number) {
    await act(async () => {
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: vbx, clientY: 100 });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  /** The tooltip card as strings: its date, and the strategy row's value text and testid. */
  function tooltip(svg: SVGSVGElement) {
    const texts = [...svg.querySelectorAll("text")];
    const name = texts.find((t) => (t.textContent ?? "").startsWith(STRATEGY_PREFIX));
    if (!name) throw new Error("no strategy row in the tooltip");
    const value = name.nextElementSibling as SVGTextElement;
    const date = name.parentElement?.parentElement?.querySelector(":scope > text")?.textContent ?? "";
    return { date, value: (value.textContent ?? "").trim(), testId: value.getAttribute("data-testid") };
  }
  /** The legend chip's reading for the strategy (the first button under the chart's header). */
  function legendValue(container: HTMLElement, title: string): string {
    const fig = mustFigure(container, title);
    const chip = fig.querySelector<HTMLButtonElement>("button[aria-pressed]");
    return (chip?.querySelector("span.font-mono")?.textContent ?? "").trim();
  }

  async function withRect<T>(fn: () => Promise<T>): Promise<T> {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 880, bottom: 280, width: 880, height: 280, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    try {
      return await fn();
    } finally {
      rect.mockRestore();
    }
  }
  // The plot's right edge is VB_W (880) minus the 30-unit right pad: hovering there is the last index.
  const LAST_X = 850;
  // About two units per index at 400 observations, so two units left is the index before.
  const PREV_X = 848;

  for (const title of ROLLING) {
    it(`${title}: the strategy row prints a dash at the last index and a figure at the one before`, async () => {
      await withRect(async () => {
        const payload = asBuilt(WITHHELD_DQ);
        const w = await mountBody(payload);
        const svg = chartSvg(w.container, title);
        await hover(svg, LAST_X);
        const last = tooltip(svg);
        expect(last.date, "the card is dated the record's last day").toBe(formatDay(payload.dates[payload.dates.length - 1]));
        expect(last.testId).toBe("crosshair-value-withheld");
        expect(last.value).toBe("—");
        expect(legendValue(w.container, title), "the legend chip carries the same hover reading").toBe("—");
        await hover(svg, PREV_X);
        const prev = tooltip(svg);
        expect(prev.date, "the card moved to the day before").toBe(formatDay(payload.dates[payload.dates.length - 2]));
        expect(prev.testId).toBeNull();
        expect(prev.value, "the previous index prints a figure").toMatch(/\d/);
        expect(legendValue(w.container, title)).toMatch(/\d/);
        w.unmount();
      });
    }, SNAPSHOT_TIMEOUT_MS);
  }

  it("comparator rows are unchanged at the last index (a figure, no withheld testid)", async () => {
    await withRect(async () => {
      const w = await mountBody(asBuilt(WITHHELD_DQ));
      const svg = chartSvg(w.container, "Rolling Volatility");
      await hover(svg, LAST_X);
      const rows = [...svg.querySelectorAll("text")].filter(
        (t) => t.getAttribute("text-anchor") === "end" && t.getAttribute("font-weight") === "600",
      );
      const withheld = rows.filter((t) => t.getAttribute("data-testid") === "crosshair-value-withheld");
      expect(withheld, "exactly the strategy row").toHaveLength(1);
      const others = rows.filter((t) => t.getAttribute("data-testid") !== "crosshair-value-withheld");
      expect(others.length, "premise: the comparator row is in the card").toBeGreaterThan(0);
      for (const t of others) expect((t.textContent ?? "").trim(), "the comparator keeps its figure").toMatch(/\d/);
      w.unmount();
    });
  }, SNAPSHOT_TIMEOUT_MS);

  it("inside a zoom the last index shows a figure (railAvgWithheld is false there)", async () => {
    await withRect(async () => {
      const payload = asBuilt(WITHHELD_DQ);
      // Start after 0, end at the record's last day: a zoom whose right edge IS the last index.
      const w = await mountBody(payload, [10, payload.dates.length - 1]);
      const svg = chartSvg(w.container, "Rolling Volatility");
      await hover(svg, LAST_X);
      const last = tooltip(svg);
      expect(last.date, "premise: the card is dated the last day").toBe(formatDay(payload.dates[payload.dates.length - 1]));
      expect(last.testId).toBeNull();
      expect(last.value).toMatch(/\d/);
      w.unmount();
    });
  }, SNAPSHOT_TIMEOUT_MS);

  it("a Dated row and a clean row show a figure at the last index", async () => {
    await withRect(async () => {
      for (const dq of [DATED, CLEAN]) {
        const payload = dq === CLEAN ? payloadWithComparator(CLEAN) : asBuilt(dq);
        const w = await mountBody(payload);
        const svg = chartSvg(w.container, "Rolling Volatility");
        await hover(svg, LAST_X);
        const last = tooltip(svg);
        expect(last.testId).toBeNull();
        expect(last.value).toMatch(/\d/);
        w.unmount();
      }
    });
  }, SNAPSHOT_TIMEOUT_MS);
});

/* -------------------------------------------------------------------------- */
/* 252. The options-cash-wallet cause on an intact chain                       */
/* -------------------------------------------------------------------------- */

describe("252: an options book on an INTACT chain withholds every secondary rendering, with the muted options sentence", () => {
  const NULL_SEVEN = { cumulative_return: null, volatility: null, max_drawdown: null, cagr: null, sharpe: null, sortino: null, calmar: null };
  /** The payload as the read path builds it: the REAL builder, so the seven windows are nulled by it. */
  function optionsPayload(dq: DQ = OPTIONS_DQ): FactsheetPayload {
    const built = buildFactsheetPayload(META, dense(400), { dataQuality: dq, metricsByBasis: { cash_settlement: NULL_SEVEN } });
    if (!built) throw new Error("buildFactsheetPayload returned null in test");
    return { ...built, periodsPerYear: 365, activeComparator: "btc" } as FactsheetPayload;
  }
  const noteTextOf = (n: HTMLElement) => (n.textContent ?? "").trim();

  it("premise: the payload carries no chain break, and its trailing windows are nulled by the builder", () => {
    const p = optionsPayload();
    expect(p.dataQuality?.twrChainBroken).toBeUndefined();
    for (const k of ["mtd", "ytd", "p3m", "p6m", "p1y", "p3y", "p5y"] as const) expect(p.strategyMetrics[k], k).toBeNull();
  });

  it("End-of-Year Returns: one muted note with the options sentence, no glyph, no svg, no percent figure", async () => {
    const w = await mountBody(optionsPayload());
    const fig = mustFigure(w.container, "End-of-Year Returns");
    const notes = [...fig.querySelectorAll<HTMLElement>('[data-testid="chart-withheld-note"]')];
    expect(notes).toHaveLength(1);
    expect(noteTextOf(notes[0])).toBe(PANEL_OPTIONS);
    expect(notes[0].getAttribute("style") ?? "", "muted, not the warning colour").toContain("--color-text-muted");
    expect(fig.querySelector("svg")).toBeNull();
    expect(fig.textContent).not.toMatch(/\d%/);
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("Monthly Returns: every row's YTD cell reads the dash", async () => {
    const w = await mountBody(optionsPayload());
    const cells = w.container.querySelectorAll('[data-testid="heatmap-ytd-withheld"]');
    expect(cells.length, "premise: more than one year row").toBeGreaterThan(1);
    for (const c of cells) expect((c.textContent ?? "").trim()).toBe("—");
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("Worst 10 Drawdown Periods: the title and one muted options note, no frame, band or percent", async () => {
    const w = await mountBody(optionsPayload());
    const fig = mustFigure(w.container, "Worst 10 Drawdown Periods");
    const notes = fig.querySelectorAll<HTMLElement>('[data-testid="chart-withheld-note"]');
    expect(notes).toHaveLength(1);
    expect(noteTextOf(notes[0])).toBe(PANEL_OPTIONS);
    expect(fig.querySelector("svg")).toBeNull();
    expect(fig.textContent).not.toMatch(/\d%/);
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("the whole body names the options reason and never the chain-break wording or the recomputing sentence", async () => {
    const w = await mountBody(optionsPayload());
    const text = w.container.textContent ?? "";
    expect(text).toContain(PANEL_OPTIONS);
    expect(text).not.toContain("break in the return chain");
    expect(text).not.toContain("recomputed");
    expect(w.container.textContent).not.toContain("⚠ Withheld");
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("the strip's seven cells and the rail's trailing windows read the dash", async () => {
    const w = await mountBody(optionsPayload());
    const values = [...w.container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-value"]')];
    expect(values.length, "the strip is mounted").toBeGreaterThanOrEqual(7);
    for (const v of values) expect((v.textContent ?? "").trim(), "every strip cell reads the dash").toBe("—");
    const returns = [...w.container.querySelectorAll("section")].find((s) => s.querySelector("h3")?.textContent === "Returns");
    expect(returns, "the Returns panel is mounted").toBeDefined();
    for (const label of ["Year-to-date", "3 Month", "6 Month", "1 Year"]) {
      const tr = [...returns!.querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
      expect(tr?.querySelectorAll("td")[1]?.textContent, label).toBe("—");
    }
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("WR-02: inside a zoom the rolling charts print no avg label (the rail dashes the same figure); a chain-broken Withheld row keeps it (D-78)", async () => {
    const avgLabels = (container: HTMLElement) =>
      [...mustFigure(container, "Rolling Volatility").querySelectorAll("svg text")].filter((t) =>
        /^avg /.test((t.textContent ?? "").trim()),
      );
    const zoom: [number, number] = [10, 300];
    const options = await mountBody(optionsPayload(), zoom);
    expect(avgLabels(options.container), "options cause: no printed cash-wallet average in a range").toHaveLength(0);
    options.unmount();
    const chainBroken = await mountBody(asBuilt(WITHHELD_DQ), zoom);
    expect(avgLabels(chainBroken.container), "premise and D-78: a chain-break slice keeps its average").toHaveLength(1);
    chainBroken.unmount();
  }, SNAPSHOT_TIMEOUT_MS);

  it("control: a clean row of the same series draws the End-of-Year chart, so the notes above are decisions", async () => {
    const clean = payloadWithComparator(CLEAN);
    const w = await mountBody(clean);
    expect(mustFigure(w.container, "End-of-Year Returns").querySelector("svg")).not.toBeNull();
    w.unmount();
  }, SNAPSHOT_TIMEOUT_MS);
});
