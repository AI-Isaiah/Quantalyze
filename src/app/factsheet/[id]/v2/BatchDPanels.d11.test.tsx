import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type {
  ComputeSummary,
  FactsheetPayload,
  OwnBookDeltaPayload,
  PeerPercentilePayload,
} from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import {
  shortTrackMarkerTitle,
  widenedShortNote,
  widenedWithheldReason,
  type FigureRecord,
} from "@/lib/figure-gate";
import { FactsheetProvider } from "./factsheet-context";
import { OwnBookDeltaPanel, PeerPercentilePanel, StyleDriftPanel } from "./BatchDPanels";

/**
 * Phase 194 plan 16 (TRUST-05; D-04 / D-11 as superseded by D-15, D-13) - the three Batch D panels.
 *
 * WHY these cases carry the weight. D-15 splits a figure's fate in two: the TOTAL record decides
 * whether an annualized figure is WITHHELD; the window the figure covers (a half, the compared
 * window of two records, a blend) only QUALIFIES it with one muted note. The superseded D-04
 * reading withheld a half or a delta on its OWN span, which would blank a Sharpe the founder
 * decided to show. So:
 *   - a half of 60 days inside a cleared 260-day record keeps its Sharpe and gets the note for
 *     the SHORTER half (the note must not read the longer one, or it understates the shortfall);
 *   - a record that fails the gate blanks the annualized rows in both halves and the delta;
 *   - a delta over a 60-day compared window keeps its values when both records clear.
 * Skew, Kurtosis, Max Drawdown, Win % and the Max DD delta are not annualized and never move.
 * All figures are synthetic.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

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
// Installed per test: `unstubGlobals: true` restores stubbed globals before every test.
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });

const U2212 = "−";

function makeReturnsSeries(n: number): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: 0.0015 + Math.sin(i * 0.27) * 0.005 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const crypto = (spanDays: number): FigureRecord => ({ spanDays, observations: null, crypto: true });
const trad = (observations: number, spanDays: number): FigureRecord => ({ spanDays, observations, crypto: false });

function isoPlus(days: number): string {
  return new Date(Date.UTC(2024, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A half whose own figures are distinct per half, covering `days` days (D-20: both ends counted). */
function half(days: number, n: number, offset: number): ComputeSummary {
  return {
    start: isoPlus(0),
    end: isoPlus(days - 1),
    n,
    sharpe: 1.1 + offset,
    sortino: 1.6 + offset,
    ann_vol: 0.2 + offset / 10,
    skew: -0.3 + offset,
    kurt: 3.1 + offset,
    max_dd: -0.12 - offset / 10,
    win_rate: 0.52 + offset / 10,
  } as unknown as ComputeSummary;
}

function styleDriftPayload(record: FigureRecord | null, d1: number, d2: number, n = 200): FactsheetPayload {
  const base = buildScenarioFactsheetPayload({ portfolioDaily: makeReturnsSeries(300), benchmark: null });
  return {
    ...base,
    figureRecord: record,
    styleDrift: { h1: half(d1, n, 0), h2: half(d2, n, 0.2), ksD: 0.123, ksP: 0.456 },
  } as FactsheetPayload;
}

function mount(payload: FactsheetPayload, panel: React.ReactElement) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      {panel}
    </FactsheetProvider>,
  );
}

/** The cell texts of the row whose label cell reads `label`: [first, second, delta]. */
function rowCells(container: HTMLElement, label: string): string[] {
  const labelCell = Array.from(container.querySelectorAll("td")).find((td) => td.textContent === label);
  if (!labelCell) throw new Error(`row not found: ${label}`);
  const cells = Array.from((labelCell.parentElement as HTMLElement).querySelectorAll("td"));
  return cells.slice(1).map((td) => td.textContent ?? "");
}

const ANNUALIZED_ROWS = ["Sharpe", "Sortino", "Ann. Volatility"];
const OTHER_ROWS = ["Skew", "Kurtosis", "Max Drawdown", "Win % (days)"];

describe("StyleDriftPanel - halves follow the record, the note follows the shorter half (D-04 / D-15)", () => {
  it("a cleared 260-day crypto record with halves of 60 and 200 days: every figure shows, the note is the 60-day half's", () => {
    const { container, getByTestId } = mount(styleDriftPayload(crypto(260), 60, 200), <StyleDriftPanel />);
    for (const label of ANNUALIZED_ROWS) {
      for (const cell of rowCells(container, label)) expect(cell, label).not.toBe("—");
    }
    expect(getByTestId("style-drift-figure-gate-note").textContent).toBe(widenedShortNote("half", 60));
  });

  it("halves of 150 and 200 days: values and the delta show, the note is the 150-day half's", () => {
    const { container, getByTestId } = mount(styleDriftPayload(crypto(350), 150, 200), <StyleDriftPanel />);
    for (const label of ANNUALIZED_ROWS) {
      for (const cell of rowCells(container, label)) expect(cell, label).not.toBe("—");
    }
    expect(getByTestId("style-drift-figure-gate-note").textContent).toBe(widenedShortNote("half", 150));
  });

  it("a crypto record of 80 days (halves of 40): the three annualized rows and their delta print a dash, the note is the record's withheld reason", () => {
    const record = crypto(80);
    const { container, getByTestId } = mount(styleDriftPayload(record, 40, 40), <StyleDriftPanel />);
    for (const label of ANNUALIZED_ROWS) {
      expect(rowCells(container, label), label).toEqual(["—", "—", "—"]);
    }
    expect(getByTestId("style-drift-figure-gate-note").textContent).toBe(widenedWithheldReason("half", record));
  });

  it("a non-crypto record of 60 observations over 84 days: values show, the note is the shorter half's", () => {
    const { container, getByTestId } = mount(styleDriftPayload(trad(60, 84), 30, 54, 30), <StyleDriftPanel />);
    for (const label of ANNUALIZED_ROWS) {
      for (const cell of rowCells(container, label)) expect(cell, label).not.toBe("—");
    }
    expect(getByTestId("style-drift-figure-gate-note").textContent).toBe(widenedShortNote("half", 30));
  });

  it("a non-crypto record of 59 observations withholds the annualized rows however long its span", () => {
    const record = trad(59, 800);
    const { container, getByTestId } = mount(styleDriftPayload(record, 400, 400), <StyleDriftPanel />);
    for (const label of ANNUALIZED_ROWS) expect(rowCells(container, label)).toEqual(["—", "—", "—"]);
    expect(getByTestId("style-drift-figure-gate-note").textContent).toBe(widenedWithheldReason("half", record));
  });

  it("halves of 400 days each: values show and there is no note", () => {
    const { container, queryByTestId } = mount(styleDriftPayload(crypto(800), 400, 400), <StyleDriftPanel />);
    for (const label of ANNUALIZED_ROWS) {
      for (const cell of rowCells(container, label)) expect(cell, label).not.toBe("—");
    }
    expect(queryByTestId("style-drift-figure-gate-note")).toBeNull();
  });

  it("an absent record is the null state: values show and no note", () => {
    const { container, queryByTestId } = mount(styleDriftPayload(null, 60, 200), <StyleDriftPanel />);
    for (const label of ANNUALIZED_ROWS) {
      for (const cell of rowCells(container, label)) expect(cell, label).not.toBe("—");
    }
    expect(queryByTestId("style-drift-figure-gate-note")).toBeNull();
  });

  it("Skew, Kurtosis, Max Drawdown and Win % print identically whether the annualized rows are withheld, short or full", () => {
    const withheld = mount(styleDriftPayload(crypto(80), 40, 40), <StyleDriftPanel />).container;
    const short = mount(styleDriftPayload(crypto(260), 40, 40), <StyleDriftPanel />).container;
    const full = mount(styleDriftPayload(crypto(800), 40, 40), <StyleDriftPanel />).container;
    for (const label of OTHER_ROWS) {
      const expected = rowCells(full, label);
      expect(expected.every((c) => c !== "—" && c !== ""), label).toBe(true);
      expect(rowCells(short, label), label).toEqual(expected);
      expect(rowCells(withheld, label), label).toEqual(expected);
    }
  });

  it("thin halves (n below 126): the sentence is muted, with no warning colour and no glyph (A-194-D13-03)", () => {
    const { container, getByText } = mount(styleDriftPayload(crypto(800), 400, 400, 100), <StyleDriftPanel />);
    const line = getByText(/One or both halves have/);
    expect(line.className).toContain("text-text-muted");
    expect(line.getAttribute("style") ?? "").not.toContain("warning");
    expect(line.textContent).not.toContain("⚠");
    expect(container.textContent).not.toContain("⚠");
  });
});

// --- Peer percentile ----------------------------------------------------------

const SCENARIO_PEER: PeerPercentilePayload = { cohortSize: 42, sharpe: 71, sortino: 64, max_dd: 58 };

function peerPayload(record: FigureRecord | null): FactsheetPayload {
  const base = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
    scenarioPeer: SCENARIO_PEER,
  });
  return { ...base, figureRecord: record } as FactsheetPayload;
}

/**
 * The label span of a percentile bar, found by the Term that names it (Phase 201 plan 09, D-01):
 * the term's own words are the trigger, the qualifier after them (`(shallower = better)`) is plain
 * text beside it, and the span's whole text must read the label.
 */
function labelSpan(container: HTMLElement, text: string): HTMLElement {
  const head = text.split(" (")[0];
  const hit = Array.from(container.querySelectorAll<HTMLElement>("[data-term]"))
    .filter((t) => t.textContent === head)
    // Term renders label span > Tooltip wrapper > Tooltip inner span > trigger.
    .map((t) => t.parentElement!.parentElement!.parentElement as HTMLElement)
    .find((span) =>
      Array.from(span.childNodes)
        .filter((n) => n.nodeType === 3 || n === span.firstElementChild)
        .map((n) => n.textContent)
        .join("") === text,
    );
  if (!hit) throw new Error(`label not found: ${text}`);
  return hit;
}

function markerOf(label: HTMLElement): HTMLElement | null {
  return label.querySelector("span[title]");
}

describe("PeerPercentilePanel - the blend's `<1y` marker follows its record (D-11 / D-15)", () => {
  it("a blend record of 300 days: Sharpe and Sortino carry the marker with its title, Max DD carries none", () => {
    const { container } = mount(peerPayload(crypto(300)), <PeerPercentilePanel />);
    for (const label of ["Sharpe", "Sortino"]) {
      const marker = markerOf(labelSpan(container, label));
      expect(marker, label).not.toBeNull();
      expect(marker?.textContent).toContain("<1y");
      expect(marker?.getAttribute("title")).toBe(shortTrackMarkerTitle(300));
      expect(marker?.querySelector(".sr-only")?.textContent?.trim()).toBe(shortTrackMarkerTitle(300));
    }
    expect(markerOf(labelSpan(container, "Max DD (shallower = better)"))).toBeNull();
  });

  it("a blend record of 120 days (rankable since the 252 floor retired): the marker names 120 days", () => {
    const { container } = mount(peerPayload(crypto(120)), <PeerPercentilePanel />);
    expect(markerOf(labelSpan(container, "Sharpe"))?.getAttribute("title")).toBe(shortTrackMarkerTitle(120));
    expect(markerOf(labelSpan(container, "Sortino"))?.getAttribute("title")).toBe(shortTrackMarkerTitle(120));
  });

  it("a record of 400 days, or an absent record: no marker", () => {
    for (const record of [crypto(400), null]) {
      const { container, unmount } = mount(peerPayload(record), <PeerPercentilePanel />);
      expect(container.querySelector("span[title]")).toBeNull();
      expect(container.textContent).not.toContain("<1y");
      unmount();
    }
  });

  it("a withheld blend (backstop, plan 05 never sends one) ranks Sharpe and Sortino as no rank and keeps Max DD", () => {
    const { container } = mount(peerPayload(crypto(60)), <PeerPercentilePanel />);
    expect(container.textContent).not.toContain("71th");
    expect(container.textContent).not.toContain("64th");
    expect(container.textContent).toContain("58th");
    expect(container.querySelector("span[title]")).toBeNull();
  });
});

// --- vs Your Allocation -------------------------------------------------------------

function ownBookPayload(delta: OwnBookDeltaPayload): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
    scenarioOwnBookDelta: delta,
  });
}

const DELTA_BASE = { sharpe: 0.24, sortino: -0.18, max_dd: 0.018, blend_n: 287, book_n: 412 };

function valueCell(container: HTMLElement, label: string): HTMLElement {
  const labelCell = Array.from(container.querySelectorAll("td")).find((td) => td.textContent === label);
  if (!labelCell) throw new Error(`row not found: ${label}`);
  return labelCell.nextElementSibling as HTMLElement;
}

describe("OwnBookDeltaPanel - the Sharpe and Sortino deltas follow both records (D-11 / D-15)", () => {
  it("a crypto 60-day blend record against a 400-day book record (span 59): the two ratio deltas print an untoned dash, Max DD keeps its value, the note is the delta withheld reason", () => {
    const records = { blend: crypto(60), book: crypto(400) };
    const { container, getByTestId } = mount(
      ownBookPayload({ ...DELTA_BASE, span_days: 59, records }),
      <OwnBookDeltaPanel />,
    );
    for (const label of ["Sharpe", "Sortino"]) {
      const cell = valueCell(container, label);
      expect(cell.textContent, label).toBe("—");
      expect(cell.getAttribute("style"), label).toBeNull();
    }
    expect(valueCell(container, "Max DD (blend vs allocation)").textContent).toBe("+1.8pp");
    expect(getByTestId("own-book-delta-note").textContent).toBe(widenedWithheldReason("delta", records.blend));
  });

  it("both records failing: the note names the shorter record", () => {
    const records = { blend: crypto(60), book: crypto(30) };
    const { getByTestId } = mount(ownBookPayload({ ...DELTA_BASE, span_days: 30, records }), <OwnBookDeltaPanel />);
    expect(getByTestId("own-book-delta-note").textContent).toBe(widenedWithheldReason("delta", records.book));
  });

  it("both records cleared over a 60-day compared window: the deltas show, the note is the short note (a short window qualifies, never withholds)", () => {
    const records = { blend: crypto(100), book: crypto(400) };
    const { container, getByTestId } = mount(
      ownBookPayload({ ...DELTA_BASE, span_days: 60, records }),
      <OwnBookDeltaPanel />,
    );
    expect(valueCell(container, "Sharpe").textContent).toBe("+0.24");
    expect(valueCell(container, "Sortino").textContent).toBe(`${U2212}0.18`);
    expect(getByTestId("own-book-delta-note").textContent).toBe(widenedShortNote("delta", 60));
  });

  it("a 200-day compared window: the deltas show with the 200-day note; a 400-day window prints no note", () => {
    const records = { blend: crypto(250), book: crypto(400) };
    const shortOne = mount(ownBookPayload({ ...DELTA_BASE, span_days: 200, records }), <OwnBookDeltaPanel />);
    expect(valueCell(shortOne.container, "Sharpe").textContent).toBe("+0.24");
    expect(shortOne.getByTestId("own-book-delta-note").textContent).toBe(widenedShortNote("delta", 200));
    shortOne.unmount();

    const full = mount(ownBookPayload({ ...DELTA_BASE, span_days: 400, records }), <OwnBookDeltaPanel />);
    expect(valueCell(full.container, "Sharpe").textContent).toBe("+0.24");
    expect(full.queryByTestId("own-book-delta-note")).toBeNull();
  });

  it("absent records or span_days: the deltas show as before and there is no note", () => {
    const bare = mount(ownBookPayload({ ...DELTA_BASE }), <OwnBookDeltaPanel />);
    expect(valueCell(bare.container, "Sharpe").textContent).toBe("+0.24");
    expect(bare.queryByTestId("own-book-delta-note")).toBeNull();
    bare.unmount();

    const noSpan = mount(
      ownBookPayload({ ...DELTA_BASE, records: { blend: crypto(250), book: crypto(400) } }),
      <OwnBookDeltaPanel />,
    );
    expect(valueCell(noSpan.container, "Sharpe").textContent).toBe("+0.24");
    expect(noSpan.queryByTestId("own-book-delta-note")).toBeNull();
  });
});
