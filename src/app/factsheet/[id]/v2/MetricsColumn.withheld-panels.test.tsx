/** @vitest-environment jsdom */
/**
 * Phase 237 FACTSHEETHONEST plan 03 (FACT-01, founder ruling Q1, 2026-11-23): on a Withheld
 * full-history view with no what-if, the Worst 10 Drawdowns rail panel keeps its header and
 * replaces its whole body with ONE amber note. Inside a selected range it keeps its own windowed
 * slice ("A zoomed window keeps its slice"). The failed cause stays omitted as today.
 *
 * The two FH237 sentences (UI-SPEC Copywriting Contract: FH237-PANEL-WITHHELD and
 * FH237-PANEL-RECOMPUTING) are HAND-TYPED here and never imported, so a reworded component
 * cannot rewrite its own oracle. Plan 12 adds EOY Returns, Calmar by Year and Style Drift to this
 * file, on the same slot and component.
 *
 * Why a whole-body replacement and not a dash: a Worst 10 row is a peak, a trough and a depth
 * measured across a break the Withheld note names, and a Withheld row cannot say which drawdown
 * straddles it. A table of dashes would still print the rank and the dates beside a "withheld"
 * headline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import {
  buildFactsheetPayload,
  deriveSeriesBundle,
  fixtureBenchmarkPrices,
} from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";
import { MetricsColumn, PanelWithheldNote, headlineCoverageNote } from "./MetricsColumn";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

const TITLE = "Worst 10 Drawdowns";
const NOTE_TESTID = "panel-withheld-note";
const WARNING = "var(--color-warning, #B45309)";
const R3 =
  "a zero or negative account balance, a near-zero account balance and a one-day gain or loss larger than the balance";

/** FH237-PANEL-WITHHELD with {R} filled by the three guard reasons. HAND-TYPED. */
const PANEL_WITHHELD = `Withheld: this panel covers earlier history, which is unreliable (it includes ${R3}), and the span after it has not been measured yet.`;
/** FH237-PANEL-RECOMPUTING. HAND-TYPED. */
const PANEL_RECOMPUTING = "Withheld while the headline figures are recomputed.";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
function dense(n: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01,
  }));
}
const META = {
  id: "withheld-panels-test",
  name: "Withheld Panels Test",
  types: ["test"],
  markets: ["crypto"],
  computedAt: "2026-09-29T00:00:00Z",
  trustTier: null,
  ingestSource: "csv" as const,
};

function payloadWith(dataQuality: FactsheetPayload["dataQuality"]): FactsheetPayload {
  const built = buildFactsheetPayload(META, dense(400));
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return { ...built, periodsPerYear: 365, dataQuality, activeComparator: "btc" } as FactsheetPayload;
}

/** The seven stored headline scalars the read path nulls on a Withheld row. */
function withHeadlineNaN(p: FactsheetPayload): FactsheetPayload {
  return {
    ...p,
    strategyMetrics: {
      ...p.strategyMetrics,
      cum_ret: NaN,
      cagr: NaN,
      sharpe: NaN,
      sortino: NaN,
      calmar: NaN,
      max_dd: NaN,
      ann_vol: NaN,
    },
  } as FactsheetPayload;
}

type DQ = NonNullable<FactsheetPayload["dataQuality"]>;
const GUARDS = ["negative_nav", "dust_nav", "pnl_dominated"] as const;
const DATED: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineCoversFrom: "2026-04-18",
  headlineGuardReasons: [...GUARDS],
};
const WITHHELD_DQ: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineWithheld: true,
  headlineGuardReasons: [...GUARDS],
};
const CLEAN: DQ = { composite: false, insufficientWindow: false };

const withheldRow = () => withHeadlineNaN(payloadWith(WITHHELD_DQ));

/** A Withheld row with a live mark-to-market bundle (the verdict describes the CASH headline only). */
function withheldWithMtm(): FactsheetPayload {
  const cash = withheldRow();
  const slice = dense(400).slice(60);
  const mtm = deriveSeriesBundle(slice, {
    periodsPerYear: 365,
    isArithmetic: false,
    markets: [],
    strategyName: "Withheld Panels Test",
    benchmarkPrices: fixtureBenchmarkPrices([slice]),
    figureRecord: null,
  });
  return {
    ...cash,
    seriesByBasis: { mark_to_market: mtm },
    metricsByBasis: {
      mark_to_market: {
        cumulative_return: 0.05,
        cagr: 0.1,
        volatility: 0.2,
        sharpe: 0.5,
        sortino: 0.7,
        max_drawdown: -0.1,
        calmar: 1,
      },
    },
    mtmGate: { available: true },
  } as unknown as FactsheetPayload;
}

type Part = "all" | "detailed";
const PARTS: Part[] = ["all", "detailed"];

function SetBasis({ basis }: { basis: Basis }) {
  const { setBasis } = useBasis();
  useEffect(() => {
    setBasis(basis);
  }, [basis, setBasis]);
  return null;
}
function SetLeverage({ value }: { value: number }) {
  const { setLeverage } = useLeverage();
  useEffect(() => {
    setLeverage(value);
  }, [value, setLeverage]);
  return null;
}
function Zoom({ range }: { range: [number, number] }) {
  const { setXRange } = useXRange();
  return (
    <button data-testid="zoom" onClick={() => setXRange(range)}>
      zoom
    </button>
  );
}

interface Opts {
  part?: Part;
  zoom?: [number, number];
  basis?: Basis;
  leverage?: number;
}

/** Renders the real column; a zoom is applied the way a reader does it, through the x-range. */
async function mount(payload: FactsheetPayload, opts: Opts = {}) {
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <LeverageProvider>
          {opts.basis && <SetBasis basis={opts.basis} />}
          {opts.leverage !== undefined && <SetLeverage value={opts.leverage} />}
          {opts.zoom && <Zoom range={opts.zoom} />}
          <MetricsColumn part={opts.part ?? "all"} />
        </LeverageProvider>
      </BasisProvider>
    </FactsheetProvider>,
  );
  if (opts.zoom) {
    await act(async () => {
      fireEvent.click(view.container.querySelector('[data-testid="zoom"]')!);
    });
  }
  return view;
}

function worstSections(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("section")].filter((s) =>
    (s.querySelector(":scope > header h3")?.textContent ?? "").trim().startsWith(TITLE),
  );
}

/** The one Worst 10 panel, reduced to what the assertions read (RTL cleanup empties containers). */
function readPanel(container: HTMLElement) {
  const hits = worstSections(container);
  if (hits.length === 0) return null;
  expect(hits, `exactly one "${TITLE}" panel`).toHaveLength(1);
  const section = hits[0];
  const notes = [...section.querySelectorAll<HTMLElement>(`[data-testid="${NOTE_TESTID}"]`)];
  const rows = [...section.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  return {
    section,
    notes,
    rowCount: rows.length,
    cells: rows.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())),
    tables: section.querySelectorAll("table").length,
    html: section.innerHTML,
  };
}

describe("headlineCoverageNote(.., 'panel') — the one source of the withheld panel sentence", () => {
  it("cause absent: FH237-PANEL-WITHHELD with {R} filled, variant withheld", () => {
    expect(headlineCoverageNote(WITHHELD_DQ, "cash_settlement", "panel")).toEqual({
      variant: "withheld",
      text: PANEL_WITHHELD,
    });
  });

  it("cause recomputing: FH237-PANEL-RECOMPUTING, naming no span and no reason", () => {
    const note = headlineCoverageNote({ ...WITHHELD_DQ, headlineWithheldCause: "recomputing" }, "cash_settlement", "panel");
    expect(note).toEqual({ variant: "withheld", text: PANEL_RECOMPUTING });
  });

  it("cause failed: null, so no panel and no second cause beside the page's own failed line", () => {
    expect(headlineCoverageNote({ ...WITHHELD_DQ, headlineWithheldCause: "failed" }, "cash_settlement", "panel")).toBeNull();
  });

  it("{R} goes through joinGuardPhrases for one reason, two, and zero (the no-reason phrase the headline sentence uses)", () => {
    const text = (reasons: DQ["headlineGuardReasons"]) =>
      headlineCoverageNote({ ...WITHHELD_DQ, headlineGuardReasons: reasons }, "cash_settlement", "panel")?.text;
    expect(text(["dust_nav"])).toBe(
      "Withheld: this panel covers earlier history, which is unreliable (it includes a near-zero account balance), and the span after it has not been measured yet.",
    );
    expect(text(["negative_nav", "pnl_dominated"])).toBe(
      "Withheld: this panel covers earlier history, which is unreliable (it includes a zero or negative account balance and a one-day gain or loss larger than the balance), and the span after it has not been measured yet.",
    );
    expect(text([])).toBe(
      "Withheld: this panel covers earlier history, which is unreliable (it includes a break in the return chain), and the span after it has not been measured yet.",
    );
    expect(text(undefined)).toBe(
      "Withheld: this panel covers earlier history, which is unreliable (it includes a break in the return chain), and the span after it has not been measured yet.",
    );
  });

  it("a Dated row, a clean row and a non-cash basis get no panel sentence: the slot never produces a Dated one", () => {
    expect(headlineCoverageNote(DATED, "cash_settlement", "panel")).toBeNull();
    expect(headlineCoverageNote(CLEAN, "cash_settlement", "panel")).toBeNull();
    expect(headlineCoverageNote(undefined, "cash_settlement", "panel")).toBeNull();
    expect(headlineCoverageNote(WITHHELD_DQ, "mark_to_market", "panel")).toBeNull();
  });
});

describe("PanelWithheldNote — the single markup source of a withheld panel body", () => {
  it("renders exactly one amber italic paragraph with the glyph, the test id and no role or aria", () => {
    const { container } = render(<PanelWithheldNote note={{ variant: "withheld", text: PANEL_RECOMPUTING }} />);
    expect(container.children).toHaveLength(1);
    const p = container.firstElementChild as HTMLElement;
    expect(p.tagName).toBe("P");
    expect(p.getAttribute("data-testid")).toBe(NOTE_TESTID);
    expect(p.className).toBe("text-fixed-10 italic");
    expect(p.getAttribute("style")).toContain(WARNING);
    expect(p.textContent).toBe(`⚠ ${PANEL_RECOMPUTING}`);
    for (const attr of ["role", "aria-live", "aria-label"]) expect(p.hasAttribute(attr), attr).toBe(false);
  });

  it("takes a test id override (plan 09's chart slot)", () => {
    const { container } = render(<PanelWithheldNote note={{ variant: "withheld", text: "x" }} testId="chart-withheld-note" />);
    expect(container.querySelector('[data-testid="chart-withheld-note"]')).not.toBeNull();
  });
});

describe.each(PARTS)("Worst 10 Drawdowns on a Withheld row, mount site part=%s", (part) => {
  it("full history: the header stays and the body is exactly one panel-withheld-note, no table", async () => {
    const { container } = await mount(withheldRow(), { part });
    const panel = readPanel(container);
    if (panel === null) throw new Error("premise: the Worst 10 panel mounts on a Withheld full-history row");
    expect(panel.notes).toHaveLength(1);
    expect(panel.notes[0].textContent).toBe(`⚠ ${PANEL_WITHHELD}`);
    expect(panel.notes[0].getAttribute("style")).toContain(WARNING);
    expect(panel.notes[0].className).toBe("text-fixed-10 italic");
    // Header plus the one note, nothing else: no table, no wrapper, no second paragraph.
    expect(panel.section.children).toHaveLength(2);
    expect(panel.section.children[0].tagName).toBe("HEADER");
    expect(panel.section.children[1]).toBe(panel.notes[0]);
    expect(panel.tables).toBe(0);
    expect(panel.rowCount).toBe(0);
  });

  it("the withheld note wraps: no truncate, max-w, whitespace-nowrap or overflow clipping on it or any ancestor in the panel", async () => {
    const { container } = await mount(withheldRow(), { part });
    const panel = readPanel(container);
    if (panel === null) throw new Error("premise: the Worst 10 panel mounts");
    const clipping = /(^|\s)(truncate|max-w-\S+|whitespace-nowrap|overflow-hidden|text-ellipsis)(\s|$)/;
    for (let el: HTMLElement | null = panel.notes[0]; el && el !== panel.section.parentElement; el = el.parentElement) {
      expect(el.className, `${el.tagName} ${el.className}`).not.toMatch(clipping);
    }
  });

  it("no figure a withheld panel hides reaches the DOM through it: no digit from the table, no title or aria attribute", async () => {
    const dated = await mount(payloadWith(DATED), { part });
    const datedPanel = readPanel(dated.container);
    expect(datedPanel?.cells.flat().some((t) => /\d/.test(t)), "premise: the Dated table carries digits").toBe(true);
    dated.unmount();
    const { container } = await mount(withheldRow(), { part });
    const panel = readPanel(container);
    if (panel === null) throw new Error("premise: the Worst 10 panel mounts");
    // The body carries no digit at all: the note names reasons in words. (The header's own "10" is
    // the panel's title, so the read is of the body, the one element after the header.)
    expect(panel.section.children[1].textContent ?? "").not.toMatch(/\d/);
    expect(panel.html).not.toMatch(/\stitle=|aria-label=/);
  });

  it("recomputing cause: the same panel carries the FH237-PANEL-RECOMPUTING sentence", async () => {
    const dq: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "recomputing" };
    const { container } = await mount(withHeadlineNaN(payloadWith(dq)), { part });
    const panel = readPanel(container);
    if (panel === null) throw new Error("premise: the Worst 10 panel mounts");
    expect(panel.notes).toHaveLength(1);
    expect(panel.notes[0].textContent).toBe(`⚠ ${PANEL_RECOMPUTING}`);
    expect(panel.tables).toBe(0);
  });

  it("failed cause: no Worst 10 panel at all, so no note and no table", async () => {
    const dq: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "failed" };
    const { container } = await mount(withHeadlineNaN(payloadWith(dq)), { part });
    expect(worstSections(container)).toHaveLength(0);
    expect(container.querySelectorAll(`[data-testid="${NOTE_TESTID}"]`)).toHaveLength(0);
  });

  it("inside a selected range the panel keeps its windowed slice table and carries no note", async () => {
    const { container } = await mount(withheldRow(), { part, zoom: [10, 300] });
    const panel = readPanel(container);
    if (panel === null) throw new Error("premise: the zoomed Worst 10 panel mounts");
    expect(panel.rowCount, "the slice has its rows").toBeGreaterThan(0);
    expect(panel.notes).toHaveLength(0);
    expect(panel.cells.some((c) => /\d/.test(c[4] ?? "")), "a Depth figure shows inside the window").toBe(true);
  });

  it("empty edge: a Withheld row whose series has no drawdown has no Worst 10 panel (no header, no note)", async () => {
    const base = withheldRow();
    const flat = { ...base, strategyWorst10: [] } as unknown as FactsheetPayload;
    const { container } = await mount(flat, { part });
    // Premise: the same payload shape still renders the rail, so absence is the panel's own.
    expect(container.querySelector("aside")).not.toBeNull();
    expect(worstSections(container)).toHaveLength(0);
    // Plan 12: EOY Returns, Calmar by Year and Style Drift each carry their own note on this row
    // (three in all), so the absence of a Worst 10 note is read as "no note beyond those three".
    expect(container.querySelectorAll(`[data-testid="${NOTE_TESTID}"]`)).toHaveLength(3);
  });
});

describe.each(PARTS)("Worst 10 Drawdowns with the gate off is unchanged, mount site part=%s", (part) => {
  it("a Dated row renders the table with its figures and no note", async () => {
    const { container } = await mount(payloadWith(DATED), { part });
    const panel = readPanel(container);
    if (panel === null) throw new Error("premise: a Dated row mounts the panel");
    expect(panel.tables).toBe(1);
    expect(panel.rowCount).toBeGreaterThan(0);
    expect(panel.cells.some((c) => /\d/.test(c[4] ?? ""))).toBe(true);
    expect(panel.notes).toHaveLength(0);
  });

  it("a held re-run over a Dated row (analyticsUpdating) renders the same table as the settled Dated row", async () => {
    const settled = await mount(payloadWith(DATED), { part });
    const settledPanel = readPanel(settled.container);
    if (settledPanel === null) throw new Error("premise: the settled Dated row mounts the panel");
    const settledCells = settledPanel.cells;
    settled.unmount();
    const held = await mount({ ...payloadWith(DATED), analyticsUpdating: true } as FactsheetPayload, { part });
    const heldPanel = readPanel(held.container);
    if (heldPanel === null) throw new Error("the held re-run keeps the Dated panel");
    expect(heldPanel.notes).toHaveLength(0);
    expect(heldPanel.cells).toEqual(settledCells);
  });

  it("a clean row renders the table and no note", async () => {
    const { container } = await mount(payloadWith(CLEAN), { part });
    const panel = readPanel(container);
    if (panel === null) throw new Error("premise: a clean row mounts the panel");
    expect(panel.tables).toBe(1);
    expect(panel.notes).toHaveLength(0);
  });

  it("under mark-to-market the same Withheld payload keeps its table (the verdict describes the cash headline only); under cash it is the note", async () => {
    const payload = withheldWithMtm();
    const cash = await mount(payload, { part, basis: "cash_settlement" });
    const cashPanel = readPanel(cash.container);
    expect(cashPanel?.notes, "premise: cash withholds the panel").toHaveLength(1);
    cash.unmount();
    const mtm = await mount(payload, { part, basis: "mark_to_market" });
    const panel = readPanel(mtm.container);
    if (panel === null) throw new Error("MTM keeps the Worst 10 panel");
    expect(panel.tables).toBe(1);
    expect(panel.rowCount).toBeGreaterThan(0);
    expect(panel.notes).toHaveLength(0);
  });

  it("with what-if leverage applied a clean row renders the table and no note; a Withheld row cannot be levered, so it stays withheld at L=2", async () => {
    const levered = await mount(payloadWith(CLEAN), { part, leverage: 2 });
    const panel = readPanel(levered.container);
    if (panel === null) throw new Error("a levered clean row keeps the Worst 10 panel");
    expect(panel.tables).toBe(1);
    expect(panel.notes).toHaveLength(0);
    levered.unmount();
    // leverageEligibleFor excludes chain-broken rows, so leverage never reaches a Withheld row and
    // the leverage term in the gate is provably false there.
    const withheld = await mount(withheldRow(), { part, leverage: 2 });
    const withheldPanel = readPanel(withheld.container);
    expect(withheldPanel?.notes).toHaveLength(1);
    expect(withheldPanel?.tables).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Plan 12: EOY Returns, Calmar by Year and Style Drift (founder rulings Q2 and Q3, 2026-11-23).
//
// The three panels read the WHOLE record even inside a zoom, so unlike Worst 10 they stay
// withheld under a selected range (gate `fullHistoryWithheld`, not `wholeRecordWithheld`). On the
// failed cause they are not mounted. Every sentence is the same hand-typed FH237 text above.
// ---------------------------------------------------------------------------------------------

interface PanelSpec {
  name: string;
  /** The panel's heading text starts with this. */
  title: string;
  /** Whether the panel carries a Full history scope note beside its title inside a zoom. */
  scopeNoteInZoom: boolean;
}
const WHOLE_RECORD_PANELS: PanelSpec[] = [
  { name: "EOY Returns", title: "EOY Returns", scopeNoteInZoom: true },
  { name: "Calmar by Year", title: "Calmar by Year", scopeNoteInZoom: true },
  { name: "Style Drift", title: "Style Drift", scopeNoteInZoom: false },
];

function sectionsTitled(container: HTMLElement, title: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("section")].filter((s) =>
    (s.querySelector(":scope > header h3")?.textContent ?? "").trim().startsWith(title),
  );
}

/** One named panel reduced to strings and counts (RTL cleanup empties containers). */
function readNamed(container: HTMLElement, title: string) {
  const hits = sectionsTitled(container, title);
  if (hits.length === 0) return null;
  expect(hits, `exactly one "${title}" panel`).toHaveLength(1);
  const section = hits[0];
  const rows = [...section.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  return {
    section,
    notes: [...section.querySelectorAll<HTMLElement>(`[data-testid="${NOTE_TESTID}"]`)].map((n) => (n.textContent ?? "").trim()),
    rowCount: rows.length,
    cells: rows.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())),
    tables: section.querySelectorAll("table").length,
    scopeNotes: section.querySelectorAll('[data-testid="scope-note"]').length,
    text: section.textContent ?? "",
    bodyText: section.children[1]?.textContent ?? "",
    html: section.innerHTML,
    childCount: section.children.length,
    firstChildTag: section.children[0]?.tagName ?? "",
  };
}

/** Section eyebrows and names, in order: what a reader sees as the rail's numbering. */
function sectionHeads(container: HTMLElement): string[] {
  return [...container.querySelectorAll("h2")].map(
    (h) => `${(h.previousElementSibling?.textContent ?? "").trim()} ${(h.textContent ?? "").trim()}`,
  );
}

describe.each(WHOLE_RECORD_PANELS)("$name on a Withheld row", (spec) => {
  describe.each(PARTS)("mount site part=%s", (part) => {
    it("full history: the header stays and the body is exactly one panel-withheld-note, no table and no year row", async () => {
      const { container } = await mount(withheldRow(), { part });
      const panel = readNamed(container, spec.title);
      if (panel === null) throw new Error(`premise: ${spec.name} mounts on a Withheld full-history row`);
      expect(panel.notes).toEqual([`⚠ ${PANEL_WITHHELD}`]);
      expect(panel.childCount, "header plus the one note").toBe(2);
      expect(panel.firstChildTag).toBe("HEADER");
      expect(panel.tables).toBe(0);
      expect(panel.rowCount).toBe(0);
    });

    it("no figure the panel hides reaches the DOM through it: no digit in the body, no title or aria attribute, no footnote", async () => {
      const dated = await mount(payloadWith(DATED), { part });
      const datedPanel = readNamed(dated.container, spec.title);
      expect(datedPanel?.cells.flat().some((t) => /\d/.test(t)), `premise: the Dated ${spec.name} table carries digits`).toBe(true);
      dated.unmount();
      const { container } = await mount(withheldRow(), { part });
      const panel = readNamed(container, spec.title);
      if (panel === null) throw new Error(`premise: ${spec.name} mounts`);
      expect(panel.bodyText).not.toMatch(/\d/);
      expect(panel.html).not.toMatch(/\stitle=|aria-label=/);
      expect(panel.text).not.toMatch(/Kolmogorov|D = |p = |partial|trading days|\d{4}/);
    });

    it("recomputing cause: the FH237-PANEL-RECOMPUTING sentence", async () => {
      const dq: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "recomputing" };
      const { container } = await mount(withHeadlineNaN(payloadWith(dq)), { part });
      const panel = readNamed(container, spec.title);
      if (panel === null) throw new Error(`premise: ${spec.name} mounts`);
      expect(panel.notes).toEqual([`⚠ ${PANEL_RECOMPUTING}`]);
      expect(panel.tables).toBe(0);
    });

    it("failed cause: the panel is not mounted, so no note and no table", async () => {
      const dq: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "failed" };
      const { container } = await mount(withHeadlineNaN(payloadWith(dq)), { part });
      expect(container.querySelector("aside")).not.toBeNull();
      expect(sectionsTitled(container, spec.title)).toHaveLength(0);
      expect(container.querySelectorAll(`[data-testid="${NOTE_TESTID}"]`)).toHaveLength(0);
    });

    it("inside a selected range the panel stays withheld (it shows the whole record), and keeps its scope note where it has one", async () => {
      const { container } = await mount(withheldRow(), { part, zoom: [10, 300] });
      const panel = readNamed(container, spec.title);
      if (panel === null) throw new Error(`premise: ${spec.name} mounts inside a zoom`);
      expect(panel.notes).toEqual([`⚠ ${PANEL_WITHHELD}`]);
      expect(panel.tables).toBe(0);
      expect(panel.rowCount).toBe(0);
      expect(panel.scopeNotes).toBe(spec.scopeNoteInZoom ? 1 : 0);
    });

    it("gate off, a Dated row: the table renders with its figures and no note", async () => {
      const { container } = await mount(payloadWith(DATED), { part });
      const panel = readNamed(container, spec.title);
      if (panel === null) throw new Error(`premise: a Dated row mounts ${spec.name}`);
      expect(panel.tables).toBe(1);
      expect(panel.rowCount).toBeGreaterThan(0);
      expect(panel.cells.flat().some((t) => /\d/.test(t))).toBe(true);
      expect(panel.notes).toHaveLength(0);
    });

    it("gate off, a held re-run over a Dated row (analyticsUpdating): the same table as the settled Dated row", async () => {
      const settled = await mount(payloadWith(DATED), { part });
      const settledPanel = readNamed(settled.container, spec.title);
      if (settledPanel === null) throw new Error("premise: the settled Dated row mounts the panel");
      const settledCells = settledPanel.cells;
      settled.unmount();
      const held = await mount({ ...payloadWith(DATED), analyticsUpdating: true } as FactsheetPayload, { part });
      const heldPanel = readNamed(held.container, spec.title);
      if (heldPanel === null) throw new Error("the held re-run keeps the Dated panel");
      expect(heldPanel.notes).toHaveLength(0);
      expect(heldPanel.cells).toEqual(settledCells);
    });

    it("gate off, a clean row: the table renders and no note", async () => {
      const { container } = await mount(payloadWith(CLEAN), { part });
      const panel = readNamed(container, spec.title);
      if (panel === null) throw new Error(`premise: a clean row mounts ${spec.name}`);
      expect(panel.tables).toBe(1);
      expect(panel.notes).toHaveLength(0);
    });

    it("gate off, mark-to-market: the same Withheld payload keeps its table; under cash it is the note", async () => {
      const payload = withheldWithMtm();
      const cash = await mount(payload, { part, basis: "cash_settlement" });
      expect(readNamed(cash.container, spec.title)?.notes, "premise: cash withholds the panel").toHaveLength(1);
      cash.unmount();
      const mtm = await mount(payload, { part, basis: "mark_to_market" });
      const panel = readNamed(mtm.container, spec.title);
      if (panel === null) throw new Error(`MTM keeps ${spec.name}`);
      expect(panel.tables).toBe(1);
      expect(panel.rowCount).toBeGreaterThan(0);
      expect(panel.notes).toHaveLength(0);
    });

    it("gate off, what-if leverage on a clean row: the table renders; a Withheld row cannot be levered and stays withheld", async () => {
      const levered = await mount(payloadWith(CLEAN), { part, leverage: 2 });
      const panel = readNamed(levered.container, spec.title);
      if (panel === null) throw new Error(`a levered clean row keeps ${spec.name}`);
      expect(panel.tables).toBe(1);
      expect(panel.notes).toHaveLength(0);
      levered.unmount();
      const withheld = await mount(withheldRow(), { part, leverage: 2 });
      expect(readNamed(withheld.container, spec.title)?.notes).toHaveLength(1);
    });
  });
});

describe("EOY Returns and Calmar by Year on a Withheld row: panel-specific edges", () => {
  it("the withheld EOY Returns panel drops the vs-comparator bench header and the comparator column", async () => {
    const dated = await mount(payloadWith(DATED), { part: "all" });
    expect(readNamed(dated.container, "EOY Returns")?.text, "premise: a Dated row names the comparator").toMatch(/BTC/);
    dated.unmount();
    const { container } = await mount(withheldRow(), { part: "all" });
    const panel = readNamed(container, "EOY Returns");
    expect(panel?.text).not.toMatch(/BTC/);
  });

  it("a Withheld row whose panels have no years keeps them absent (no header, no note)", async () => {
    const base = withheldRow();
    const noYears = {
      ...base,
      calmarByYear: [],
      strategyMetrics: { ...base.strategyMetrics, yearly: {} },
      comparators: Object.fromEntries(Object.entries(base.comparators).map(([k, v]) => [k, { ...v, dailyReturns: null }])),
    } as unknown as FactsheetPayload;
    const { container } = await mount(noYears, { part: "all" });
    expect(container.querySelector("aside")).not.toBeNull();
    expect(sectionsTitled(container, "Calmar by Year")).toHaveLength(0);
    expect(sectionsTitled(container, "EOY Returns")).toHaveLength(0);
  });
});

describe("Style Drift on a Withheld row: the Kolmogorov-Smirnov line and the failed-arm Style section", () => {
  it.each(PARTS)("part=%s: a Dated row prints the KS sentence and the half-dates subline; a Withheld row prints neither", async (part) => {
    const dated = await mount(payloadWith(DATED), { part });
    const datedPanel = readNamed(dated.container, "Style Drift");
    expect(datedPanel?.text, "premise: the Dated panel carries the KS sentence").toMatch(/Kolmogorov-Smirnov: D = /);
    expect(datedPanel?.text, "premise: the Dated panel carries the half-dates subline").toMatch(/\(\d+d\)/);
    dated.unmount();
    const { container } = await mount(withheldRow(), { part });
    const panel = readNamed(container, "Style Drift");
    expect(panel?.text).not.toMatch(/Kolmogorov|D = |\(\d+d\)|< 126/);
    expect(panel?.html).not.toContain("style-drift-figure-gate-note");
  });

  it("detailed part, failed cause: no Style heading renders, and the numbering is exactly that of a strategy with no Style Drift", async () => {
    const dq: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "failed" };
    const failed = withHeadlineNaN(payloadWith(dq));
    const dated = await mount(payloadWith(DATED), { part: "detailed" });
    expect(sectionHeads(dated.container).join("|"), "premise: a Dated row has a numbered Style section").toMatch(/§III Style/);
    dated.unmount();
    const withStyle = await mount(failed, { part: "detailed" });
    const failedHeads = sectionHeads(withStyle.container);
    withStyle.unmount();
    expect(failedHeads.join("|")).not.toMatch(/Style/);
    const noStyle = await mount({ ...failed, styleDrift: null } as unknown as FactsheetPayload, { part: "detailed" });
    expect(failedHeads).toEqual(sectionHeads(noStyle.container));
  });

  it("detailed part, a Withheld row that is not failed keeps the Style section and its numbering", async () => {
    const { container } = await mount(withheldRow(), { part: "detailed" });
    expect(sectionHeads(container).join("|")).toMatch(/§III Style/);
  });
});
