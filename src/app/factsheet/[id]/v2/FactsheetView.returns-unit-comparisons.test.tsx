/** @vitest-environment jsdom */
/**
 * Phase 164.6.6.2 plan 06 (D-10, D-17; UI-SPEC A5, A11, A14-A22) — a strategy whose
 * returns are in BTC is never compared with BTC, and nothing else is hidden.
 *
 * Two halves, and both must be able to fail:
 *   WITHHELD  — every figure that pairs the strategy with BTC (a BTC benchmark in
 *               BTC is a flat line; the USD-priced one mixes units) reads "—",
 *               untoned, under a line that says `returns are in BTC`.
 *   UNCHANGED — D-17 narrowed D-10 to ONLY those figures. Every SPX-dependent
 *               figure, every non-BTC correlation, the demo blends and the peer
 *               percentile render the SAME text and DOM as the no-unit build of
 *               the same series. A comparison that goes `—` "because of the unit"
 *               is the over-reach D-17 forbids.
 *
 * The no-unit payload below is built from the SAME `dailyReturns` as the unit
 * payload, so the unchanged half is a measurement against the current build, not
 * against a hand-typed expectation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload, StressWindowPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const lsStore = new Map<string, string>();
const localStorageMock = {
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
};
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true` (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  lsStore.clear();
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { MetricsColumn } from "./MetricsColumn";
import { SignaturesSection } from "./SignaturePanels";
import { CrossSignaturesSection } from "./CrossSignaturePanels";
import { CorrelationStripPanel, CorrelationsMatrixPanel, EndOfYearBarsPanel } from "./DistributionPanels";
import { StressWindowsPanel } from "./StressWindowsPanel";

const DAY = 86_400_000;
const START = Date.parse("2025-06-01T00:00:00Z");

/** The SAME series for every payload in this file, unit or not. */
const DAILY = Array.from({ length: 200 }, (_, i) => ({
  date: new Date(START + i * DAY).toISOString().slice(0, 10),
  value: (i % 2 === 0 ? 1 : -1) * (0.004 + (i % 5) * 0.001),
}));

type Cmp = FactsheetPayload["activeComparator"];

function makePayload(unit: string | null, cmp: Cmp): FactsheetPayload & { ingestSource: "api" } {
  const payload = buildFactsheetPayload(
    {
      id: "p06-strategy",
      name: "Plan 06 Strategy",
      types: ["quant"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    DAILY,
    unit === null ? undefined : { returnsUnit: unit },
  );
  if (!payload || payload.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  // The server pins a unit's default to "none"; a test picks SPX the way the picker does.
  return { ...payload, activeComparator: cmp };
}

function renderIn(payload: FactsheetPayload, node: React.ReactElement) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      {node}
    </FactsheetProvider>,
  );
}

function renderBody(payload: FactsheetPayload) {
  return renderIn(payload, <FactsheetBody payload={payload} hideAllocatorSection hideFooter />);
}

/** The §IV `Benchmark` section, or null when the rail does not render one. */
function sectionIV(container: HTMLElement): HTMLElement | null {
  const h2 = Array.from(container.querySelectorAll("h2")).find((h) => (h.textContent ?? "").startsWith("Benchmark"));
  return (h2?.closest("section") as HTMLElement | null) ?? null;
}

/** Every row's value cell (the second `td`) in a section. */
function valueCells(section: HTMLElement): HTMLElement[] {
  return Array.from(section.querySelectorAll("tbody tr")).map((tr) => tr.querySelectorAll("td")[1] as HTMLElement);
}

const kpiLabels = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-label"]')).map((el) => el.textContent ?? "");

/** The unit label the no-unit build does not carry. Stripping it leaves the rest comparable. */
const stripUnit = (html: string) => html.replaceAll(" in BTC", "");

describe("preconditions: the fixture measures something", () => {
  it("SPX has a real joint on the shared series, so an SPX figure that went '—' would be a visible change", () => {
    const p = makePayload(null, "spx");
    expect(p.comparators.spx.joint).not.toBeNull();
    expect(Number.isFinite(p.comparators.spx.joint!.alpha)).toBe(true);
  });

  it("the unit payload carries the same SPX joint as the no-unit payload (the builder does not touch SPX)", () => {
    expect(makePayload("BTC", "spx").comparators.spx.joint).toEqual(makePayload(null, "spx").comparators.spx.joint);
  });
});

describe("A15 §IV Benchmark", () => {
  it("BTC unit, no comparator: 'Benchmark — vs BTC', every row '—', untoned, with the stated reason", () => {
    const { container } = renderIn(makePayload("BTC", "none"), <MetricsColumn />);
    const sec = sectionIV(container);
    expect(sec, "a BTC strategy must still show its Benchmark section").not.toBeNull();
    expect(sec!.querySelector("h2")!.textContent).toBe("Benchmark — vs BTC");
    const cells = valueCells(sec!);
    expect(cells.length).toBe(9);
    for (const td of cells) {
      expect(td.textContent).toBe("—");
      expect(td.className).not.toContain("text-accent");
      expect(td.className).toContain("text-text-primary");
    }
    expect(sec!.querySelector('[data-testid="joint-floor-reason"]')!.textContent).toBe(
      "Not measurable: returns are in BTC. A BTC benchmark measured in BTC is a flat line.",
    );
  });

  it("the reason composes from the unit, so another unit reads its own code", () => {
    const { container } = renderIn(makePayload("ETH", "none"), <MetricsColumn />);
    expect(sectionIV(container)!.querySelector('[data-testid="joint-floor-reason"]')!.textContent).toBe(
      "Not measurable: returns are in ETH. A BTC benchmark measured in ETH is a flat line.",
    );
  });

  it("BTC unit, SPX active: 'Benchmark — vs SPX' and the §IV text and DOM equal the no-unit build (D-17)", () => {
    const unit = renderIn(makePayload("BTC", "spx"), <MetricsColumn />);
    const plain = renderIn(makePayload(null, "spx"), <MetricsColumn />);
    const a = sectionIV(unit.container)!;
    const b = sectionIV(plain.container)!;
    expect(a.querySelector("h2")!.textContent).toBe("Benchmark — vs SPX");
    expect(a.textContent).toBe(b.textContent);
    expect(a.innerHTML).toBe(b.innerHTML);
    // Not vacuous: the SPX joint is a number, not a row of dashes.
    expect(valueCells(a).some((td) => td.textContent !== "—")).toBe(true);
    expect(a.querySelector('[data-testid="joint-floor-reason"]')).toBeNull();
  });

  it("the whole SPX rail of a BTC strategy equals the no-unit rail, apart from the unit in its labels (D-17, A14)", () => {
    const unit = renderIn(makePayload("BTC", "spx"), <MetricsColumn />);
    const plain = renderIn(makePayload(null, "spx"), <MetricsColumn />);
    expect(stripUnit(unit.container.innerHTML)).toBe(plain.container.innerHTML);
  });

  it("a USD strategy with no comparator renders no §IV at all, as today", () => {
    const { container } = renderIn(makePayload(null, "none"), <MetricsColumn />);
    expect(sectionIV(container)).toBeNull();
  });
});

describe("A16 Returns Signatures are BTC event studies, so they stay withheld", () => {
  const REASON = "Not measurable: returns are in BTC.";

  for (const cmp of ["none", "spx"] as const) {
    it(`SignaturesSection, comparator ${cmp}: every panel is the empty form with the reason, no chart`, () => {
      const { container } = renderIn(makePayload("BTC", cmp), <SignaturesSection />);
      const empty = container.querySelectorAll("figure[data-signature-empty]");
      expect(empty).toHaveLength(8);
      expect(container.querySelectorAll("figure")).toHaveLength(8);
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      for (const f of Array.from(empty)) {
        expect(f.textContent).toContain("—");
        expect(f.textContent).toContain(REASON);
      }
    });

    it(`CrossSignaturesSection, comparator ${cmp}: every panel is the empty form with the reason, no chart`, () => {
      const { container } = renderIn(makePayload("BTC", cmp), <CrossSignaturesSection />);
      const empty = container.querySelectorAll("figure[data-signature-empty]");
      expect(empty).toHaveLength(8);
      expect(container.querySelectorAll("figure")).toHaveLength(8);
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      for (const f of Array.from(empty)) {
        expect(f.textContent).toContain(REASON);
      }
    });
  }

  it("a USD strategy still charts both sections (the gate is the unit)", () => {
    const sig = renderIn(makePayload(null, "spx"), <SignaturesSection />);
    expect(sig.container.querySelectorAll("figure[data-signature-empty]")).toHaveLength(0);
    expect(sig.container.querySelectorAll("svg").length).toBeGreaterThan(0);
    const cross = renderIn(makePayload(null, "spx"), <CrossSignaturesSection />);
    expect(cross.container.querySelectorAll("figure[data-signature-empty]")).toHaveLength(0);
    expect(cross.container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("the section is mounted and in the nav for a BTC strategy with NO comparator, but not for a USD one", () => {
    const unit = renderBody(makePayload("BTC", "none"));
    expect(unit.container.querySelector("#factsheet-signatures")).not.toBeNull();
    expect(unit.container.querySelector('a[href="#factsheet-signatures"]')).not.toBeNull();
    const plain = renderBody(makePayload(null, "none"));
    expect(plain.container.querySelector("#factsheet-signatures")).toBeNull();
    expect(plain.container.querySelector('a[href="#factsheet-signatures"]')).toBeNull();
  });
});

describe("A5 KPI strip never carries a BTC-relative cell", () => {
  it("SPX active: 9 cells, α vs SPX and IR vs SPX, nothing vs BTC", () => {
    const labels = kpiLabels(renderBody(makePayload("BTC", "spx")).container);
    expect(labels).toHaveLength(9);
    expect(labels).toContain("α vs SPX");
    expect(labels).toContain("IR vs SPX");
    expect(labels.some((l) => l.includes("vs BTC"))).toBe(false);
  });

  it("no comparator: 7 cells, nothing vs anything", () => {
    const labels = kpiLabels(renderBody(makePayload("BTC", "none")).container);
    expect(labels).toHaveLength(7);
    expect(labels.some((l) => l.includes(" vs "))).toBe(false);
  });

  it("the SPX α and IR values equal the no-unit strip's (D-17)", () => {
    const value = (c: HTMLElement, label: string) => {
      const el = Array.from(c.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-label"]')).find(
        (e) => e.textContent === label,
      )!;
      return el.parentElement!.textContent!.replace(label, "");
    };
    const unit = renderBody(makePayload("BTC", "spx")).container;
    const plain = renderBody(makePayload(null, "spx")).container;
    for (const label of ["α vs SPX", "IR vs SPX"]) {
      expect(value(unit, label)).toBe(value(plain, label));
      expect(value(unit, label)).not.toBe("—");
    }
  });
});

/** The strip's rows: name, the rho text, and whether a bar was drawn. */
function stripRows(container: HTMLElement) {
  const groups = [...container.querySelectorAll("svg g")].filter((g) => g.querySelectorAll("text").length === 2);
  return groups.map((g) => {
    const t = g.querySelectorAll("text");
    return { name: t[0].textContent ?? "", rho: t[1].textContent ?? "", bars: g.querySelectorAll("rect").length };
  });
}

describe("A17 Cross-Asset Correlation strip", () => {
  const SENTENCE = "BTC row not measurable: returns are in BTC.";
  const subtitle = (c: HTMLElement) => c.querySelector("figure header p")!.textContent ?? "";

  it("the BTC row reads '—' with no bar, and the subtitle says why", () => {
    const { container } = renderIn(makePayload("BTC", "spx"), <CorrelationStripPanel />);
    const btc = stripRows(container).find((r) => r.name === "BTC")!;
    expect(btc.rho).toBe("—");
    expect(btc.bars).toBe(0);
    expect(subtitle(container)).toContain(SENTENCE);
  });

  it("ETH, S&P 500, Gold and US 10Y keep the no-unit rows exactly (D-17)", () => {
    const unit = stripRows(renderIn(makePayload("BTC", "spx"), <CorrelationStripPanel />).container);
    const plain = stripRows(renderIn(makePayload(null, "spx"), <CorrelationStripPanel />).container);
    expect(unit.map((r) => r.name)).toEqual(plain.map((r) => r.name));
    const others = (rows: typeof unit) => rows.filter((r) => r.name !== "BTC");
    expect(others(unit)).toHaveLength(4);
    expect(others(unit)).toEqual(others(plain));
    // Not vacuous: the no-unit BTC row is a measured number with a bar.
    const plainBtc = plain.find((r) => r.name === "BTC")!;
    expect(plainBtc.rho).not.toBe("—");
    expect(plainBtc.bars).toBe(1);
    // None of the four kept rows went to a dash because of the unit.
    expect(others(unit).every((r) => r.rho !== "—" && r.bars === 1)).toBe(true);
  });

  it("a USD strategy's strip carries no such sentence and is otherwise unchanged", () => {
    const { container } = renderIn(makePayload(null, "spx"), <CorrelationStripPanel />);
    expect(subtitle(container)).not.toContain("not measurable");
    expect(subtitle(container)).toBe(
      "Pearson ρ on aligned daily returns · ρ near 0 implies diversification benefit",
    );
  });
});

/** The matrix as strings: column headers, then each row's label and N cells (text + fill). */
function matrixOf(container: HTMLElement) {
  const texts = [...container.querySelectorAll("svg text")];
  const rows = Math.round((-1 + Math.sqrt(1 + 4 * texts.length)) / 2); // N + N*(N+1) = texts.length
  const headers = texts.slice(0, rows).map((t) => t.textContent ?? "");
  const cells: { text: string; fill: string | null }[][] = [];
  for (let i = 0; i < rows; i++) {
    const base = rows + i * (rows + 1);
    cells.push(texts.slice(base + 1, base + 1 + rows).map((t) => ({ text: t.textContent ?? "", fill: t.getAttribute("fill") })));
  }
  return { headers, cells };
}

describe("A18 Correlations matrix", () => {
  const CAPTION = "Strategy × BTC not measurable: returns are in BTC.";

  it("only the strategy × BTC pair reads '—', untoned; every other cell equals the no-unit build (D-17)", () => {
    const unit = matrixOf(renderIn(makePayload("BTC", "spx"), <CorrelationsMatrixPanel />).container);
    const plain = matrixOf(renderIn(makePayload(null, "spx"), <CorrelationsMatrixPanel />).container);
    expect(unit.headers).toEqual(plain.headers);
    const b = unit.headers.indexOf("BTC");
    expect(b).toBeGreaterThan(0);
    const N = unit.headers.length;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const pair = (i === 0 && j === b) || (i === b && j === 0);
        if (pair) {
          expect(unit.cells[i][j].text, `cell ${i},${j}`).toBe("—");
          expect(unit.cells[i][j].fill, `cell ${i},${j} is untoned`).toBe("var(--color-text-muted)");
          // Not vacuous: the no-unit build measures this cell.
          expect(plain.cells[i][j].text).not.toBe("—");
        } else {
          expect(unit.cells[i][j], `cell ${i},${j}`).toEqual(plain.cells[i][j]);
          expect(unit.cells[i][j].text).not.toBe("—");
        }
      }
    }
  });

  it("the caption appears once for a BTC strategy and never for a USD one", () => {
    const unit = renderIn(makePayload("BTC", "spx"), <CorrelationsMatrixPanel />).container;
    expect((unit.textContent ?? "").split(CAPTION)).toHaveLength(2);
    const plain = renderIn(makePayload(null, "spx"), <CorrelationsMatrixPanel />).container;
    expect(plain.textContent).not.toContain("not measurable");
  });
});

const STRESS: StressWindowPayload = {
  windows: [
    {
      name: "Aug 2025 unwind",
      note: "a named event",
      start: "2025-08-02",
      end: "2025-08-09",
      days: 8,
      expectedCalendarDays: 8,
      coverage: "full",
      stratReturn: -0.031,
      benchReturn: -0.12,
      stratMaxDD: -0.042,
      benchMaxDD: -0.2,
    },
    {
      name: "Oct 2025 rally",
      note: "another named event",
      start: "2025-10-01",
      end: "2025-10-08",
      days: 8,
      expectedCalendarDays: 8,
      coverage: "full",
      stratReturn: 0.05,
      benchReturn: 0.09,
      stratMaxDD: -0.01,
      benchMaxDD: -0.02,
    },
  ],
  benchName: "BTC",
  totalCatalogued: 2,
  droppedOutOfRange: 0,
  droppedPartial: 0,
};

function stressPayload(unit: string | null): FactsheetPayload {
  return { ...makePayload(unit, "none"), stressWindows: STRESS };
}

describe("A19 Stress Windows", () => {
  const rowCells = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""));
  const subtitle = (c: HTMLElement) => c.querySelector("figure header p")!.textContent ?? "";

  it("keeps the strategy columns, reads the benchmark cells '—', and the subtitle names the reason", () => {
    const unit = renderIn(stressPayload("BTC"), <StressWindowsPanel />).container;
    const plain = renderIn(stressPayload(null), <StressWindowsPanel />).container;
    const u = rowCells(unit);
    const p = rowCells(plain);
    expect(u).toHaveLength(2);
    for (let r = 0; r < u.length; r++) {
      // Event, Window, Days, Strategy, Strat DD: the BTC series alone, unchanged.
      expect(u[r].slice(0, 5)).toEqual(p[r].slice(0, 5));
      expect(u[r].slice(5)).toEqual(["—", "—"]);
      // Not vacuous: the no-unit build prints numbers there.
      expect(p[r].slice(5).every((t) => t !== "—")).toBe(true);
    }
    expect(subtitle(unit)).toBe(
      "strategy compounded return in BTC + max drawdown during named market events · BTC column not shown: returns are in BTC",
    );
  });

  it("the withheld benchmark cells carry the muted colour, never a gain or loss colour", () => {
    const { container } = renderIn(stressPayload("BTC"), <StressWindowsPanel />);
    for (const tr of Array.from(container.querySelectorAll("tbody tr"))) {
      const [benchRet, benchDD] = Array.from(tr.querySelectorAll("td")).slice(-2) as HTMLElement[];
      expect(benchRet.style.color).toBe("var(--color-text-muted)");
      expect(benchDD.style.color).toBe("var(--color-text-muted)");
    }
  });

  it("a USD strategy's subtitle and cells are as today", () => {
    const { container } = renderIn(stressPayload(null), <StressWindowsPanel />);
    expect(subtitle(container)).toBe("strategy vs BTC compounded return + max drawdown during named market events");
  });
});

/**
 * The carry-forward decision from plan 05, pinned so a change to it is deliberate.
 *
 * D-09 names two places for "in BTC": the equity chart and the return KPI labels, and
 * UI-SPEC A13/A20 enumerate the rows (Main Metrics `Cumulative Return` and `CAGR`, the
 * `EOY Returns` table title). UI-SPEC A23 leaves every other panel unchanged, "the
 * masthead chip covers them". The End-of-Year Returns bars chart and the Cumulative
 * Return Metrics panel's CAGR row are in no enumeration, so they keep their bare labels.
 */
describe("A23 surfaces the unit rule does not name keep their labels", () => {
  it("the End-of-Year Returns bars chart keeps its title for a BTC strategy", () => {
    const { container } = renderIn(makePayload("BTC", "none"), <EndOfYearBarsPanel />);
    expect(container.querySelector("h3")!.textContent).toBe("End-of-Year Returns");
  });

  it("the Cumulative Return Metrics panel's CAGR row keeps its label, while Main Metrics' CAGR names the unit", () => {
    const { container } = renderIn(makePayload("BTC", "none"), <MetricsColumn />);
    const panel = (title: string) =>
      Array.from(container.querySelectorAll("h3"))
        .find((h) => h.textContent === title)!
        .closest("section")!;
    const labels = (sec: HTMLElement) => Array.from(sec.querySelectorAll("tbody tr td:first-child")).map((td) => td.textContent);
    expect(labels(panel("Cumulative Return Metrics"))).toContain("CAGR");
    expect(labels(panel("Main Metrics"))).toContain("CAGR in BTC");
  });
});
