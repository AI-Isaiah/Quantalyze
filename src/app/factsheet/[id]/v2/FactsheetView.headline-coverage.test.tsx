/** @vitest-environment jsdom */
/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH plan 04 (D-01, D-03, UI-SPEC 1.3, B16, B17, B18):
 * the factsheet says which span its headline covers, in every slot that shows
 * headline figures.
 *
 * History. Phase 169 review round 1 (SFH H-1) added a caveat for a chain-broken
 * single-key row: the stored headline covered only the record after its last
 * break while the chart covered all of it. Since plan 01 EVERY stored headline
 * stat covers that one suffix (`headline_since`), and plan 02 carries the date
 * and the closed guard-reason set into `dataQuality`. This file pins what the
 * page now says: the UI-SPEC 1.3 sentences, VERBATIM and HAND-TYPED here, never
 * imported, one `it` per slot.
 *
 *   Dated    (valid `headlineCoversFrom`): muted `#64748B`, no warning glyph.
 *   Withheld (`headlineWithheld`, a legacy mixed-basis row): amber `#B45309`
 *            with the glyph, in the strip and Main Metrics only.
 *
 * A composite is covered like a single key. At HEAD (before this plan) a
 * composite showed no note at all: the note was gated on a field only the
 * single-key read path set.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { buildFactsheetPayload, deriveSeriesBundle, fixtureBenchmarkPrices } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { MetricsColumn, headlineCoverageNote } from "./MetricsColumn";
import { FactsheetBody } from "./FactsheetView";
import { ownerStateLine } from "@/lib/status-surface-copy";

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

/** The first measured day, as the read path carries it (`headline_since`). */
const SINCE = "2026-04-18";
const D = "Apr 18, 2026";
const R3 =
  "a zero or negative account balance, a near-zero account balance and a deposit or withdrawal larger than the balance";
const ALL_THREE = ["negative_nav", "dust_nav", "flow_dominated"] as const;

/** UI-SPEC 1.3, Dated, S1 without and with the alpha / IR cells. HAND-TYPED. */
const S1 = `Measured since ${D}; earlier history is unreliable (it includes ${R3}). Every figure in this strip covers only that span; the chart shows the whole record.`;
const S1_REL = `Measured since ${D}; earlier history is unreliable (it includes ${R3}). Every figure in this strip except α and IR covers only that span; α, IR and the chart cover the whole record.`;
/** S2, Rail Main Metrics, with {B} empty (no comparator selected; plan 10 pins the filled form below). */
const S2 = `Measured since ${D}; earlier history is unreliable (it includes ${R3}). Cumulative Return, CAGR, Ann. Volatility, Sharpe, Sortino and Calmar cover only that span; Skew, Kurtosis and the chart cover the whole record.`;
/** S3, Returns; S4, Max Drawdown; S5, Cumulative Return Metrics. {B} empty (no comparator selected). */
const S3 = `Measured since ${D}. The trailing returns cover only that span; Win Rate and Profit Factor cover the whole record.`;
const S4 = `Measured since ${D}. Max Drawdown covers only that span; the other figures in this panel cover the whole record.`;
const S5 = `Measured since ${D}. Every return in this panel covers only that span.`;
/** Withheld, S1 and S2. */
const WITHHELD = `Headline figures withheld: earlier history is unreliable (it includes ${R3}), and the span after it has not been measured yet.`;

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function dense(n: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01,
  }));
}

const META = {
  id: "headline-coverage-test",
  name: "Headline Coverage Test",
  types: ["test"],
  markets: ["crypto"],
  computedAt: "2026-09-29T00:00:00Z",
  trustTier: null,
  ingestSource: "csv" as const,
};

/**
 * No comparator selected: the strip shows 7 cells (no alpha, no IR). `activeComparator`
 * is the provider's initial comparator, so this is the page as it first renders for
 * a strategy with no benchmark chosen.
 */
function payloadWith(dataQuality: FactsheetPayload["dataQuality"]): FactsheetPayload {
  const built = buildFactsheetPayload(META, dense(400));
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return { ...built, periodsPerYear: 365, dataQuality, activeComparator: "none" } as FactsheetPayload;
}

/** A comparator selected (the fixture BTC leg), so the strip shows the alpha and IR cells (9 cells). */
function payloadWithComparator(dataQuality: FactsheetPayload["dataQuality"]): FactsheetPayload {
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
const DATED: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineCoversFrom: SINCE,
  headlineGuardReasons: [...ALL_THREE],
};
const DATED_COMPOSITE: DQ = { ...DATED, composite: true };
const WITHHELD_DQ: DQ = {
  composite: false,
  twrChainBroken: true,
  headlineWithheld: true,
  headlineGuardReasons: [...ALL_THREE],
};
const WITHHELD_COMPOSITE: DQ = { ...WITHHELD_DQ, composite: true };
const CLEAN: DQ = { composite: false, insufficientWindow: false };

const MUTED = "var(--color-text-muted, #64748B)";
const WARNING = "var(--color-warning, #B45309)";

/** Every <p> whose whole text is `text` (the glyph, when there is one, is part of the text). */
function notes(container: HTMLElement, text: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("p")].filter((p) => (p.textContent ?? "").trim() === text);
}

function renderColumn(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

/** The <p> children of the section that holds the "Cum. Return" KPI: the KPI strip's own caveat stack. */
function stripNotes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("section")]
    .filter((s) => [...s.querySelectorAll("p")].some((p) => (p.textContent ?? "").trim() === "Cum. Return"))
    .flatMap((s) => [...s.querySelectorAll<HTMLElement>(":scope > p")]);
}

function panelOf(p: HTMLElement | undefined): string | null {
  return p?.closest("section")?.querySelector("h3")?.textContent ?? null;
}

describe("the Dated note beside the headline, the KPI strip (D-01, UI-SPEC 1.3 S1)", () => {
  it("a single-key row: the span, the reasons and what the strip covers, muted, no glyph", () => {
    const { container } = renderBody(payloadWith(DATED));
    const found = stripNotes(container).filter((p) => (p.textContent ?? "").trim() === S1);
    expect(found).toHaveLength(1);
    expect(found[0].getAttribute("style")).toContain(MUTED);
    expect(found[0].getAttribute("style")).not.toContain("color-warning");
    expect(found[0].textContent).not.toContain("⚠");
    // A four-reason note with alpha / IR is long: it must wrap at 320 px, never clip (UI-SPEC UI Considerations).
    expect(found[0].className).not.toMatch(/truncate|whitespace-nowrap|overflow-hidden|text-ellipsis/);
  });

  it("a COMPOSITE row says the same, word for word (RED at HEAD: composites showed no note)", () => {
    const { container } = renderBody(payloadWith(DATED_COMPOSITE));
    expect(stripNotes(container).filter((p) => (p.textContent ?? "").trim() === S1)).toHaveLength(1);
  });

  it("with the alpha and IR cells shown, the strip says which two cells are the exception", () => {
    const { container } = renderBody(payloadWithComparator(DATED));
    const labels = [...container.querySelectorAll('[data-testid="factsheet-kpi-label"]')].map((e) => e.textContent);
    expect(labels.some((l) => (l ?? "").startsWith("α vs")), "premise: the alpha cell is shown").toBe(true);
    expect(stripNotes(container).filter((p) => (p.textContent ?? "").trim() === S1_REL)).toHaveLength(1);
    expect(stripNotes(container).filter((p) => (p.textContent ?? "").trim() === S1)).toHaveLength(0);
  });

  it("zero guard reasons: the break is named as a break in the return chain", () => {
    const dq: DQ = { composite: false, twrChainBroken: true, headlineCoversFrom: SINCE };
    const { container } = renderBody(payloadWith(dq));
    const expected = `Measured since ${D}; earlier history is unreliable (it includes a break in the return chain). Every figure in this strip covers only that span; the chart shows the whole record.`;
    expect(stripNotes(container).filter((p) => (p.textContent ?? "").trim() === expected)).toHaveLength(1);
  });

  it("CONTROL: a clean row shows no note anywhere on the page", () => {
    const { container } = renderBody(payloadWith(CLEAN));
    expect(container.textContent).not.toContain("Measured since");
    expect(container.textContent).not.toContain("withheld");
  });

  it("a chain-broken row with neither a valid date nor the withheld flag makes no claim (UI-SPEC 1.3 arm 3)", () => {
    for (const dq of [
      { composite: false, twrChainBroken: true } as DQ,
      { composite: false, twrChainBroken: true, headlineCoversFrom: null } as DQ,
      { composite: false, twrChainBroken: true, headlineCoversFrom: "not a date" } as DQ,
    ]) {
      const { container, unmount } = renderBody(payloadWith(dq));
      expect(container.textContent).not.toContain("Measured since");
      expect(container.textContent).not.toContain("withheld");
      unmount();
    }
  });
});

describe("the Dated note in the rail's Main Metrics (UI-SPEC 1.3 S2)", () => {
  it("a single-key row, {B} empty", () => {
    const { container } = renderColumn(payloadWith(DATED));
    const found = notes(container, S2);
    expect(found).toHaveLength(1);
    expect(panelOf(found[0])).toBe("Main Metrics");
    expect(found[0].getAttribute("style")).toContain(MUTED);
    expect(found[0].textContent).not.toContain("⚠");
  });

  it("a COMPOSITE row says the same (RED at HEAD: composites showed no note)", () => {
    const { container } = renderColumn(payloadWith(DATED_COMPOSITE));
    expect(notes(container, S2)).toHaveLength(1);
  });

  it("CONTROL: a clean row shows no note in the rail", () => {
    const { container } = renderColumn(payloadWith(CLEAN));
    expect(container.textContent).not.toContain("Measured since");
  });

  it("IN-R2-02: the sentence names only labels Main Metrics shows", () => {
    const { container } = renderColumn(payloadWith(DATED));
    const labels = [...(([...container.querySelectorAll("h3")].find((h) => h.textContent === "Main Metrics")
      ?.closest("section")?.querySelectorAll("tr td:first-child")) ?? [])].map((td) => td.textContent);
    for (const named of ["Cumulative Return", "CAGR", "Ann. Volatility", "Sharpe", "Sortino", "Calmar", "Skew", "Kurtosis"]) {
      expect(labels).toContain(named);
    }
  });

  it("under mark_to_market the figures come from the MTM series, so no note", () => {
    const cash = payloadWith(DATED);
    const mtm = deriveSeriesBundle(dense(400).slice(200), {
      periodsPerYear: 365,
      isArithmetic: false,
      markets: [],
      strategyName: "Headline Coverage Test",
      benchmarkPrices: fixtureBenchmarkPrices([dense(400).slice(200)]),
    });
    const payload = {
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
    function SetBasis({ basis }: { basis: Basis }) {
      const { setBasis } = useBasis();
      useEffect(() => {
        setBasis(basis);
      }, [basis, setBasis]);
      return null;
    }
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <BasisProvider>
          <SetBasis basis="mark_to_market" />
          <MetricsColumn />
        </BasisProvider>
      </FactsheetProvider>,
    );
    expect(container.textContent).not.toContain("Measured since");
    expect(container.textContent).not.toContain("withheld");
  });
});

describe("the span labels on the rail's Returns, Max Drawdown and Cumulative Return Metrics (UI-SPEC 1.3 S3, S4, S5; B18)", () => {
  it.each([
    ["S3 Returns", S3, "Returns"],
    ["S4 Max Drawdown", S4, "Max Drawdown"],
    ["S5 Cumulative Return Metrics", S5, "Cumulative Return Metrics"],
  ])("%s: the sentence, in its own panel, muted, no glyph, single key and composite alike", (_slot, text, panel) => {
    for (const dq of [DATED, DATED_COMPOSITE]) {
      const { container, unmount } = renderColumn(payloadWith(dq));
      const found = notes(container, text);
      expect(found, `composite=${dq.composite}`).toHaveLength(1);
      expect(panelOf(found[0])).toBe(panel);
      expect(found[0].className).toContain("text-text-muted");
      expect(found[0].getAttribute("style") ?? "").not.toContain("color-warning");
      expect(found[0].textContent).not.toContain("⚠");
      unmount();
    }
  });

  it("a Dated row shows exactly the strip's S2 note plus the three span labels in the rail, and no other span text", () => {
    const { container } = renderColumn(payloadWith(DATED));
    const spanParagraphs = [...container.querySelectorAll("p")]
      .map((p) => (p.textContent ?? "").trim())
      .filter((t) => t.startsWith("Measured since"));
    // DOM order: Performance (Main Metrics, Returns, Cumulative Return Metrics), then Risk (Max Drawdown).
    expect(spanParagraphs).toEqual([S2, S3, S5, S4]);
  });

  it("CONTROL: a clean row carries none of the three labels", () => {
    const { container } = renderColumn(payloadWith(CLEAN));
    for (const text of [S3, S4, S5]) expect(notes(container, text)).toHaveLength(0);
  });

  it("the {B} clause is the helper's own: off by default and exact when asked for (UI-SPEC 1.5; plan 10 turns it on at the rail's callers)", () => {
    const off = headlineCoverageNote(DATED, "cash_settlement", "main");
    const on = (slot: "main" | "returns" | "maxdd") =>
      headlineCoverageNote(DATED, "cash_settlement", slot, { benchShown: true })?.text;
    expect(off?.text).toBe(S2);
    expect(on("main")).toBe(S2.replace("cover only that span;", "cover only that span in both columns;"));
    expect(on("returns")).toBe(S3.replace("cover only that span;", "cover only that span in both columns;"));
    expect(on("maxdd")).toBe(S4.replace("covers only that span;", "covers only that span in both columns;"));
    // S5 has no benchmark column and S1 is the strip: neither takes the clause.
    expect(headlineCoverageNote(DATED, "cash_settlement", "cumulative", { benchShown: true })?.text).toBe(S5);
    expect(headlineCoverageNote(DATED, "cash_settlement", "strip", { benchShown: true })?.text).toBe(S1);
  });

  it("a Withheld row has a note only in the strip and Main Metrics slots", () => {
    const slots = ["strip", "stripRelative", "main", "returns", "maxdd", "cumulative"] as const;
    const got = slots.map((s) => headlineCoverageNote(WITHHELD_DQ, "cash_settlement", s)?.variant ?? null);
    expect(got).toEqual(["withheld", "withheld", "withheld", null, null, null]);
  });

  it("a clean row, a non-cash basis and the unreachable arm return null in every slot", () => {
    const slots = ["strip", "stripRelative", "main", "returns", "maxdd", "cumulative"] as const;
    for (const s of slots) {
      expect(headlineCoverageNote(CLEAN, "cash_settlement", s)).toBeNull();
      expect(headlineCoverageNote(undefined, "cash_settlement", s)).toBeNull();
      expect(headlineCoverageNote(DATED, "mark_to_market", s)).toBeNull();
      expect(headlineCoverageNote(WITHHELD_DQ, "smoothed_mtm", s)).toBeNull();
      expect(headlineCoverageNote({ composite: false, twrChainBroken: true }, "cash_settlement", s)).toBeNull();
    }
  });
});

/**
 * Plan 10 (UI-SPEC 1.5): with a comparator selected on a Dated row the rail's benchmark
 * column covers the same span (B19), so S2, S3 and S4 gain " in both columns". HAND-TYPED.
 */
const S2_B = `Measured since ${D}; earlier history is unreliable (it includes ${R3}). Cumulative Return, CAGR, Ann. Volatility, Sharpe, Sortino and Calmar cover only that span in both columns; Skew, Kurtosis and the chart cover the whole record.`;
const S3_B = `Measured since ${D}. The trailing returns cover only that span in both columns; Win Rate and Profit Factor cover the whole record.`;
const S4_B = `Measured since ${D}. Max Drawdown covers only that span in both columns; the other figures in this panel cover the whole record.`;

describe("the {B} clause ships with the benchmark-span change (UI-SPEC 1.5)", () => {
  it.each([
    ["S2 Main Metrics", S2_B, S2, "Main Metrics"],
    ["S3 Returns", S3_B, S3, "Returns"],
    ["S4 Max Drawdown", S4_B, S4, "Max Drawdown"],
  ])("%s: with a comparator selected the sentence says \"in both columns\", and the no-clause form is gone", (_slot, withB, without, panel) => {
    for (const dq of [DATED, DATED_COMPOSITE]) {
      const { container, unmount } = renderColumn(payloadWithComparator(dq));
      const found = notes(container, withB);
      expect(found, `composite=${dq.composite}`).toHaveLength(1);
      expect(panelOf(found[0])).toBe(panel);
      expect(found[0].getAttribute("style") ?? found[0].className).toMatch(/text-muted|64748B/);
      expect(notes(container, without), `composite=${dq.composite}`).toHaveLength(0);
      unmount();
    }
  });

  it.each([
    ["S2 Main Metrics", S2_B, S2],
    ["S3 Returns", S3_B, S3],
    ["S4 Max Drawdown", S4_B, S4],
  ])("%s: with NO comparator selected the sentence is the plan 04 form, without the clause", (_slot, withB, without) => {
    const { container } = renderColumn(payloadWith(DATED));
    expect(notes(container, without)).toHaveLength(1);
    expect(notes(container, withB)).toHaveLength(0);
    expect(container.textContent).not.toContain("in both columns");
  });

  it("S5 and the strip never take the clause, comparator or not", () => {
    const { container } = renderBody(payloadWithComparator(DATED));
    expect(notes(container, S5)).toHaveLength(1);
    expect(notes(container, S1_REL)).toHaveLength(1);
    const clauseParagraphs = [...container.querySelectorAll("p")].filter((p) => (p.textContent ?? "").includes("in both columns"));
    expect(clauseParagraphs.map((p) => (p.textContent ?? "").trim())).toEqual([S2_B, S3_B, S4_B]);
  });

  it("CONTROL: a clean row with a comparator selected carries no clause and no span text", () => {
    const { container } = renderColumn(payloadWithComparator(CLEAN));
    expect(container.textContent).not.toContain("in both columns");
    expect(container.textContent).not.toContain("Measured since");
  });

  it("a Withheld row with a comparator selected: the Withheld sentence is unchanged and carries no clause", () => {
    const { container } = renderColumn(payloadWithComparator(WITHHELD_DQ));
    expect(notes(container, `⚠ ${WITHHELD}`)).toHaveLength(1);
    expect(container.textContent).not.toContain("in both columns");
  });

  it("a selected range shows no clause: the range sentence replaces the S2 note and the labels step aside", async () => {
    // The range sentences are pinned in the window-kpis file; here only the absence of the clause.
    const payload = payloadWithComparator(DATED);
    function Zoom() {
      const { setXRange } = useXRange();
      return <button data-testid="zoom" onClick={() => setXRange([10, 100])}>zoom</button>;
    }
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <Zoom />
        <MetricsColumn />
      </FactsheetProvider>,
    );
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="zoom"]')!);
    });
    expect(container.textContent).not.toContain("in both columns");
  });
});

describe("the Withheld note in the strip and Main Metrics (D-03, UI-SPEC 1.3)", () => {
  it("the strip: amber, with the glyph, and the seven headline cells read the em-dash", () => {
    const payload = withHeadlineNaN(payloadWith(WITHHELD_DQ));
    const { container } = renderBody(payload);
    const found = stripNotes(container).filter((p) => (p.textContent ?? "").trim() === `⚠ ${WITHHELD}`);
    expect(found).toHaveLength(1);
    expect(found[0].getAttribute("style")).toContain(WARNING);
    expect(container.textContent).not.toContain("Measured since");
    const values = [...container.querySelectorAll('[data-testid="factsheet-kpi-value"]')].map((e) => e.textContent);
    expect(values).toEqual(["—", "—", "—", "—", "—", "—", "—"]);
  });

  it("Main Metrics: the same sentence, amber, with the glyph", () => {
    const { container } = renderColumn(withHeadlineNaN(payloadWith(WITHHELD_DQ)));
    const found = notes(container, `⚠ ${WITHHELD}`);
    expect(found).toHaveLength(1);
    expect(panelOf(found[0])).toBe("Main Metrics");
    expect(found[0].getAttribute("style")).toContain(WARNING);
  });

  it("a COMPOSITE Withheld row says the same in both slots", () => {
    const payload = withHeadlineNaN(payloadWith(WITHHELD_COMPOSITE));
    const body = renderBody(payload);
    expect(stripNotes(body.container).filter((p) => (p.textContent ?? "").trim() === `⚠ ${WITHHELD}`)).toHaveLength(1);
    body.unmount();
    const rail = renderColumn(payload);
    expect(notes(rail.container, `⚠ ${WITHHELD}`)).toHaveLength(1);
  });

  it("zero reasons: the break is named as a break in the return chain", () => {
    const dq: DQ = { composite: false, twrChainBroken: true, headlineWithheld: true };
    const { container } = renderColumn(withHeadlineNaN(payloadWith(dq)));
    expect(
      notes(
        container,
        "⚠ Headline figures withheld: earlier history is unreliable (it includes a break in the return chain), and the span after it has not been measured yet.",
      ),
    ).toHaveLength(1);
  });

  it("the Withheld row gets no span label in Returns, Max Drawdown or Cumulative Return Metrics", () => {
    const { container } = renderColumn(withHeadlineNaN(payloadWith(WITHHELD_DQ)));
    expect(container.textContent).not.toContain("Measured since");
    expect(container.textContent).not.toContain("cover only that span");
    // The Withheld sentence is Main Metrics' alone: it must not repeat in Returns, Max Drawdown or Cumulative.
    expect(container.textContent?.split("Headline figures withheld").length).toBe(2);
  });
});

/**
 * D-14 (founder, 2026-10-10, review round 2 R2-03). A chain-broken row whose
 * stored headline is withheld only because the analytics are in flight or
 * failed must not say "has not been measured yet". The sentences are HAND-TYPED.
 *
 *   recomputing (computing / pending): amber Withheld note, exactly
 *     "Headline figures are being recomputed." (no reasons, no span claim).
 *   failed: no headline note at all. The failed state is stated once, by the
 *     existing "couldn't be computed" status line, and a second cause sentence
 *     would contradict it.
 *   unmeasured (no valid headline_since): the original sentence, unchanged.
 * In every cause the figures read "—" and no whole-record figure is shown.
 */
describe("D-14 — the Withheld note names the cause (R2-03)", () => {
  const RECOMPUTING = "Headline figures are being recomputed.";
  const RECOMPUTING_DQ: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "recomputing" };
  const FAILED_DQ: DQ = { ...WITHHELD_DQ, headlineWithheldCause: "failed" };

  it("recomputing: the strip says so, amber with the glyph, the seven cells read the em-dash", () => {
    const { container } = renderBody(withHeadlineNaN(payloadWith(RECOMPUTING_DQ)));
    const found = stripNotes(container).filter((p) => (p.textContent ?? "").trim() === `⚠ ${RECOMPUTING}`);
    expect(found).toHaveLength(1);
    expect(found[0].getAttribute("style")).toContain(WARNING);
    expect(container.textContent).not.toContain("has not been measured yet");
    expect(container.textContent).not.toContain("earlier history is unreliable");
    const values = [...container.querySelectorAll('[data-testid="factsheet-kpi-value"]')].map((e) => e.textContent);
    expect(values).toEqual(["—", "—", "—", "—", "—", "—", "—"]);
  });

  it("recomputing: Main Metrics says the same sentence, once", () => {
    const { container } = renderColumn(withHeadlineNaN(payloadWith(RECOMPUTING_DQ)));
    const found = notes(container, `⚠ ${RECOMPUTING}`);
    expect(found).toHaveLength(1);
    expect(panelOf(found[0])).toBe("Main Metrics");
    expect(container.textContent).not.toContain("has not been measured yet");
  });

  it("recomputing: only the strip and Main Metrics speak, like the original Withheld note", () => {
    for (const slot of ["returns", "maxdd", "cumulative"] as const) {
      expect(headlineCoverageNote(RECOMPUTING_DQ, "cash_settlement", slot)).toBeNull();
    }
    for (const slot of ["strip", "stripRelative", "main"] as const) {
      expect(headlineCoverageNote(RECOMPUTING_DQ, "cash_settlement", slot)).toEqual({
        variant: "withheld",
        text: RECOMPUTING,
      });
    }
  });

  it("failed: no 'has not been measured yet' sentence and no second cause; the figures stay withheld", () => {
    const payload = withHeadlineNaN(payloadWith(FAILED_DQ));
    const body = renderBody(payload);
    expect(body.container.textContent).not.toContain("has not been measured yet");
    expect(body.container.textContent).not.toContain("Headline figures");
    expect(body.container.textContent).not.toContain("Measured since");
    const values = [...body.container.querySelectorAll('[data-testid="factsheet-kpi-value"]')].map((e) => e.textContent);
    expect(values).toEqual(["—", "—", "—", "—", "—", "—", "—"]);
    body.unmount();
    const rail = renderColumn(payload);
    expect(rail.container.textContent).not.toContain("has not been measured yet");
    expect(rail.container.textContent).not.toContain("Headline figures");
    for (const slot of ["strip", "stripRelative", "main", "returns", "maxdd", "cumulative"] as const) {
      expect(headlineCoverageNote(FAILED_DQ, "cash_settlement", slot)).toBeNull();
    }
  });

  it("failed: the existing status line still says it, once, in the page's own words", () => {
    expect(ownerStateLine({ state: "finished" }, { buildUnreadable: false, analyticsFailed: true })).toEqual({
      id: "KCS09-FINISHED-ANALYTICS-FAILED",
      tone: "red",
      text: "Analytics couldn't be computed from this data. We've logged the error.",
    });
  });

  it("unmeasured (no cause on the payload): the original sentence is unchanged", () => {
    const { container } = renderColumn(withHeadlineNaN(payloadWith(WITHHELD_DQ)));
    expect(notes(container, `⚠ ${WITHHELD}`)).toHaveLength(1);
    expect(container.textContent).not.toContain(RECOMPUTING);
    expect(headlineCoverageNote({ ...WITHHELD_DQ, headlineWithheldCause: undefined }, "cash_settlement", "strip")).toEqual({
      variant: "withheld",
      text: WITHHELD,
    });
  });

  it("CONTROL: a Dated row and a clean row are unchanged", () => {
    expect(headlineCoverageNote(DATED, "cash_settlement", "strip")?.text).toBe(S1);
    expect(headlineCoverageNote(CLEAN, "cash_settlement", "strip")).toBeNull();
  });
});
