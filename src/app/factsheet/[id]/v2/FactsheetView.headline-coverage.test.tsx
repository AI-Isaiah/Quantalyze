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
import { render, fireEvent, act, within } from "@testing-library/react";
import {
  buildFactsheetPayload,
  deriveSeriesBundle,
  fixtureBenchmarkPrices,
  type BenchmarkPricesOpt,
} from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";

import { applyHeadlineBasis } from "@/lib/factsheet/composite-read-path";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { MetricsColumn, headlineCoverageNote, isHeadlineWithheld } from "./MetricsColumn";
import { FactsheetBody } from "./FactsheetView";
import { WHEEL_SETTLE_MS } from "./TimeSeriesChart";
import { ownerStateLine } from "@/lib/status-surface-copy";

// `composite-read-path` imports `server-only` (a Next.js RSC build guard).
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

/** The first measured day, as the read path carries it (`headline_since`). */
const SINCE = "2026-04-18";
const D = "Apr 18, 2026";
const R3 =
  "a zero or negative account balance, a near-zero account balance and a one-day gain or loss larger than the balance";
// 164.6.6.2.3 D-14: the flow-dominance reason is retired, so the three reasons a
// page can still name are these.
const ALL_THREE = ["negative_nav", "dust_nav", "pnl_dominated"] as const;

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

  // 164.6.6.2.3 D-14, end to end: the stored dqf of a row that still carries the
  // retired flow-dominance flag, through the real read-path helper, into the real
  // rendered strip and rail. Fails if the retired reason is put back in the
  // reader's flag-to-reason table.
  it("D-14: a stored row with the retired flag prints no copy for it, only the no-cause break (strip and rail)", () => {
    const stored = { twr_chain_broken: true, headline_since: SINCE, flow_dominated_guard: true };
    const { quality } = applyHeadlineBasis({}, stored);
    const dq: DQ = { composite: false, ...quality };
    expect(dq.headlineGuardReasons, "premise: the reader named no reason").toBeUndefined();
    const retired = "deposit or withdrawal larger than the balance";
    const expected = `Measured since ${D}; earlier history is unreliable (it includes a break in the return chain). Every figure in this strip covers only that span; the chart shows the whole record.`;
    const body = renderBody(payloadWith(dq));
    expect(stripNotes(body.container).filter((p) => (p.textContent ?? "").trim() === expected)).toHaveLength(1);
    expect(body.container.textContent).not.toContain(retired);
    body.unmount();
    const rail = renderColumn(payloadWith(dq));
    expect(rail.container.textContent).toContain("it includes a break in the return chain");
    expect(rail.container.textContent).not.toContain(retired);
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

/**
 * D-15 (founder 2026-10-15, review WR-04, "Withhold them too"). The Withheld note says
 * the headline figures are withheld. The strip's alpha and IR cells are the whole-record
 * joint with the comparator, which compounds across the very break that note names, so a
 * number in those two cells under that note contradicts it. At full history, on the cash
 * basis, on a Withheld row, all nine cells therefore read "—" with no tone, in every
 * cause. The Dated contrast proves the gate is the verdict and not a blanket dash.
 */
const FLAT_DAY = 86_400_000;
const FLAT_START = "2026-04-27";
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * FLAT_DAY).toISOString().slice(0, 10);
/**
 * A record of zero returns against a BTC series that moves every day, as FactsheetBody.flat-leg.test
 * builds it. File scope since plan 15: Test F (the strip) and the rail's flat-leg test both use it.
 */
function flatPayload(dq: DQ): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(FLAT_START, i), value: 0 }));
  const btc: DailyPrice[] = Array.from({ length: 31 }, (_, i) => ({
    date: addDays(FLAT_START, i - 1),
    close: 90000 + ((i * 37) % 11) * 250 + i * 3,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const built = buildFactsheetPayload(
    { ...META, id: "headline-coverage-flat-leg", ingestSource: "api" as const },
    rows,
    { benchmarkPrices: opt },
  );
  if (!built) throw new Error("fixture must build a payload");
  return { ...built, dataQuality: dq, activeComparator: "btc" } as FactsheetPayload;
}

describe("D-15 — a Withheld strip shows no alpha or IR figure (review WR-04)", () => {
  const NEUTRAL = "var(--color-text-primary)";

  function kpiCells(container: HTMLElement) {
    const labels = [...container.querySelectorAll('[data-testid="factsheet-kpi-label"]')].map((e) => e.textContent ?? "");
    const values = [...container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-value"]')];
    return { labels, values };
  }

  it("Test A: a Withheld row with a comparator reads nine em-dashes, alpha and IR with no tone, under the unchanged note", () => {
    const { container } = renderBody(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    const { labels, values } = kpiCells(container);
    expect(values, "the cell count stays 9").toHaveLength(9);
    const alphaIdx = labels.findIndex((l) => l.startsWith("α vs"));
    const irIdx = labels.findIndex((l) => l.startsWith("IR vs"));
    expect(alphaIdx, "premise: the alpha cell is shown").toBeGreaterThanOrEqual(0);
    expect(irIdx, "premise: the IR cell is shown").toBeGreaterThanOrEqual(0);
    expect(values.map((v) => v.textContent)).toEqual(Array(9).fill("—"));
    expect(values[alphaIdx].getAttribute("style") ?? "").toContain(NEUTRAL);
    expect(values[irIdx].getAttribute("style") ?? "").toContain(NEUTRAL);
    const found = stripNotes(container).filter((p) => (p.textContent ?? "").trim() === `⚠ ${WITHHELD}`);
    expect(found, "exactly one strip note, the Withheld sentence").toHaveLength(1);
    expect(stripNotes(container)).toHaveLength(1);
  });

  it("Test B (contrast): a Dated row with the same comparator still shows numeric alpha and IR", () => {
    const { container } = renderBody(payloadWithComparator(DATED));
    const { labels, values } = kpiCells(container);
    expect(values).toHaveLength(9);
    for (const prefix of ["α vs", "IR vs"]) {
      const i = labels.findIndex((l) => l.startsWith(prefix));
      expect(i, `premise: the ${prefix} cell is shown`).toBeGreaterThanOrEqual(0);
      expect(values[i].textContent).not.toBe("—");
      expect(values[i].textContent).toMatch(/\d/);
    }
  });

  it("Test C (one discriminator): the strip and the note decide Withheld through isHeadlineWithheld", () => {
    expect(isHeadlineWithheld(WITHHELD_DQ, "cash_settlement")).toBe(true);
    expect(isHeadlineWithheld(DATED, "cash_settlement")).toBe(false);
    expect(isHeadlineWithheld(CLEAN, "cash_settlement")).toBe(false);
    expect(isHeadlineWithheld(WITHHELD_DQ, "mark_to_market")).toBe(false);
    expect(isHeadlineWithheld(WITHHELD_DQ, "smoothed_mtm")).toBe(false);
    expect(isHeadlineWithheld(undefined, "cash_settlement")).toBe(false);
    expect(isHeadlineWithheld({ ...WITHHELD_DQ, twrChainBroken: false }, "cash_settlement")).toBe(false);
  });

  const RECOMPUTING_NOTE = "Headline figures are being recomputed.";
  const ALL_DASH = Array(9).fill("—");

  it("Test D (D-15 with D-14): recomputing and failed Withheld rows dash all nine cells too", () => {
    for (const cause of ["recomputing", "failed"] as const) {
      const dq: DQ = { ...WITHHELD_DQ, headlineWithheldCause: cause };
      const { container, unmount } = renderBody(withHeadlineNaN(payloadWithComparator(dq)));
      const { labels, values } = kpiCells(container);
      expect(values.map((v) => v.textContent), cause).toEqual(ALL_DASH);
      for (const prefix of ["α vs", "IR vs"]) {
        const i = labels.findIndex((l) => l.startsWith(prefix));
        expect(i, `${cause}: premise: the ${prefix} cell is shown`).toBeGreaterThanOrEqual(0);
        expect(values[i].getAttribute("style") ?? "", cause).toContain(NEUTRAL);
      }
      if (cause === "recomputing") {
        const text = stripNotes(container).map((p) => (p.textContent ?? "").trim());
        expect(text).toEqual([`⚠ ${RECOMPUTING_NOTE}`]);
      } else {
        expect(container.textContent).not.toContain("Headline figures");
      }
      unmount();
    }
  });

  it("Test E (D-78): inside a selected window on a Withheld row alpha and IR keep the slice's own joint", async () => {
    function Zoom({ range }: { range: [number, number] }) {
      const { setXRange } = useXRange();
      return <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>;
    }
    async function zoomed(payload: FactsheetPayload) {
      const view = render(
        <FactsheetProvider payload={payload} persist={false}>
          <Zoom range={[10, 300]} />
          <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
        </FactsheetProvider>,
      );
      await act(async () => {
        fireEvent.click(view.container.querySelector('[data-testid="zoom"]')!);
      });
      return view;
    }
    function relativeValues(container: HTMLElement): string[] {
      const { labels, values } = kpiCells(container);
      return ["α vs", "IR vs"].map((prefix) => values[labels.findIndex((l) => l.startsWith(prefix))].textContent ?? "");
    }
    // Premise on the Dated payload: the same range yields a numeric slice joint, so a
    // too-short slice cannot make the Withheld assertion vacuous.
    const dated = await zoomed(payloadWithComparator(DATED));
    for (const v of relativeValues(dated.container)) expect(v, "premise: the Dated slice joint is numeric").toMatch(/\d/);
    dated.unmount();
    const withheld = await zoomed(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    for (const v of relativeValues(withheld.container)) expect(v, "the window keeps the slice joint").toMatch(/\d/);
    expect(withheld.container.textContent, "the window shows the range sentence, not the Withheld one").not.toContain(
      "Headline figures withheld",
    );
  });

  describe("Test F (UI-SPEC section 2): the flat-leg line speaks only while alpha and IR show the joint", () => {
    function stripFlatLegLines(container: HTMLElement): HTMLElement[] {
      return [...container.querySelectorAll("section")]
        .filter((s) => [...s.querySelectorAll("p")].some((p) => (p.textContent ?? "").trim() === "Cum. Return"))
        .flatMap((s) => [...s.querySelectorAll<HTMLElement>('[data-testid="joint-flat-leg-reason"]')]);
    }

    it("a Dated row shows the line under the strip (premise)", () => {
      const { container } = renderBody(flatPayload(DATED));
      expect(stripFlatLegLines(container)).toHaveLength(1);
    });

    it("a Withheld row shows no line and dashes alpha and IR: the Withheld note is the one stated cause", () => {
      const { container } = renderBody(withHeadlineNaN(flatPayload(WITHHELD_DQ)));
      expect(stripFlatLegLines(container)).toHaveLength(0);
      const { labels, values } = kpiCells(container);
      for (const prefix of ["α vs", "IR vs"]) {
        const i = labels.findIndex((l) => l.startsWith(prefix));
        expect(i, `premise: the ${prefix} cell is shown`).toBeGreaterThanOrEqual(0);
        expect(values[i].textContent).toBe("—");
      }
      // The 30-day fixture also carries the unrelated short-track caveat; the cause is stated once.
      const notesText = stripNotes(container).map((p) => (p.textContent ?? "").trim());
      expect(notesText.filter((t) => t === `⚠ ${WITHHELD}`)).toHaveLength(1);
    });
  });

  it("Test G (copy): no strip sentence claims alpha or IR are shown on a Withheld row", () => {
    const { container } = renderBody(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    const sentences = stripNotes(container).map((p) => p.textContent ?? "");
    expect(sentences.length, "premise: the Withheld note is there").toBe(1);
    for (const t of sentences) {
      expect(t).not.toContain("α");
      expect(t).not.toContain("IR cover");
      expect(t).not.toContain("IR ");
    }
  });
});

/**
 * D-15 extended (founder 2026-10-15, "Rail follows the strip"; plan 14). Plan 13 made the
 * KPI strip's alpha read "—" on a Withheld row. The rail's section IV "Alpha (ann)" row is
 * the same whole-record joint figure, so under the rail's own Withheld note ("headline
 * figures withheld") it contradicted both the note and the strip beside it: the whole-record
 * alpha compounds across the very break that note names. Scope is stated narrowly: full
 * history (no selected window, D-78), no what-if leverage, cash basis, and the Alpha (ann)
 * row ONLY. The Dated contrast proves the gate is the verdict and not a blanket dash.
 * SCOPE SUPERSEDED by plan 15 ("D-15 extended again: Dash all of them", below): the same gate now
 * dashes every whole-record rail figure, and R5 was flipped to match.
 */
describe("D-15 extended: Rail follows the strip", () => {
  const rows = (container: HTMLElement, label: string): HTMLTableRowElement[] =>
    [...container.querySelectorAll<HTMLTableRowElement>("tr")].filter(
      (tr) => (tr.querySelector("td")?.textContent ?? "").trim() === label,
    );

  /** The value cell (second td) of the one rail row whose first cell reads exactly `label`. */
  function railValueCell(container: HTMLElement, label = "Alpha (ann)"): HTMLElement {
    const found = rows(container, label);
    expect(found, `premise: exactly one rail row reads "${label}"`).toHaveLength(1);
    return found[0].querySelectorAll<HTMLElement>("td")[1];
  }

  it("R1: a Withheld full-history row dashes the rail Alpha (ann) and drops its accent", () => {
    const { container } = renderColumn(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    const cell = railValueCell(container);
    expect(cell.textContent).toBe("—");
    expect(cell.className).not.toContain("text-accent");
  });

  it("R2 (contrast): a Dated row with the same comparator keeps a numeric, accented rail Alpha (ann)", () => {
    const { container } = renderColumn(payloadWithComparator(DATED));
    const cell = railValueCell(container);
    expect(cell.textContent).toMatch(/\d/);
    expect(cell.className).toContain("text-accent");
  });

  it("R3 (with D-14): recomputing and failed Withheld rows dash the rail Alpha (ann) too", () => {
    for (const cause of ["recomputing", "failed"] as const) {
      const dq: DQ = { ...WITHHELD_DQ, headlineWithheldCause: cause };
      const { container, unmount } = renderColumn(withHeadlineNaN(payloadWithComparator(dq)));
      const cell = railValueCell(container);
      expect(cell.textContent, cause).toBe("—");
      expect(cell.className, cause).not.toContain("text-accent");
      unmount();
    }
  });

  it("R4 (D-78): inside a selected window the rail Alpha (ann) keeps the slice's own joint", async () => {
    function Zoom({ range }: { range: [number, number] }) {
      const { setXRange } = useXRange();
      return <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>;
    }
    async function zoomed(payload: FactsheetPayload) {
      const view = render(
        <FactsheetProvider payload={payload} persist={false}>
          <Zoom range={[10, 300]} />
          <MetricsColumn />
        </FactsheetProvider>,
      );
      await act(async () => {
        fireEvent.click(view.container.querySelector('[data-testid="zoom"]')!);
      });
      return view;
    }
    // Premise on the Dated payload: the same range yields a numeric slice joint, so a
    // too-short slice cannot make the Withheld assertion vacuous.
    const dated = await zoomed(payloadWithComparator(DATED));
    expect(railValueCell(dated.container).textContent, "premise: the Dated slice joint is numeric").toMatch(/\d/);
    dated.unmount();
    const withheld = await zoomed(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    expect(railValueCell(withheld.container).textContent, "the window keeps the slice joint").toMatch(/\d/);
  });

  it("R5 (flipped by plan 15): on a Withheld full-history row Beta and Information Ratio read the em-dash (D-15 extended again, 'Dash all of them', supersedes the Alpha-only pin)", () => {
    // Plan 14 pinned Beta and Information Ratio as numeric because D-15 extended named only
    // Alpha (ann). The founder extended the scope on 2026-10-15 ("Dash all of them"): every
    // whole-record rail figure dashes on a Withheld row. This flip is deliberate, not drift.
    const { container } = renderColumn(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    for (const label of ["Beta", "Information Ratio"]) {
      const cell = railValueCell(container, label);
      expect(cell.textContent, label).toBe("—");
      expect(cell.className, label).not.toContain("text-accent");
    }
  });
});

/**
 * A Withheld row with a live mark-to-market bundle. The Withheld verdict describes the CASH
 * headline only (`headlineCoverageNote` returns null off cash), so under MTM the rail's
 * figures come from the MTM series and none of the 62 cells may dash. The scalars are NaN
 * (the read path nulls them on a Withheld row) so the cash render is the redacted one.
 */
function withheldWithMtm(): FactsheetPayload {
  const cash = withHeadlineNaN(payloadWithComparator(WITHHELD_DQ));
  const slice = dense(400).slice(60);
  const mtm = deriveSeriesBundle(slice, {
    periodsPerYear: 365,
    isArithmetic: false,
    markets: [],
    strategyName: "Headline Coverage Test",
    benchmarkPrices: fixtureBenchmarkPrices([slice]),
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
function SetBasis({ basis }: { basis: Basis }) {
  const { setBasis } = useBasis();
  useEffect(() => {
    setBasis(basis);
  }, [basis, setBasis]);
  return null;
}

/**
 * D-15 extended again (founder 2026-10-15, AskUserQuestion, "Dash all of them"; plan 15).
 * This SUPERSEDES plan 14's Alpha-only scope. Scope: a Withheld row at FULL history with no
 * what-if leverage, every rail figure computed over the whole record. Dates, sample counts and
 * per-period entries are not figures to dash, and a zoom window keeps its slice figures (D-78).
 * WHY: each such figure compounds across the break the rail's own Withheld note names, so a
 * number under that note contradicts it (the same reasoning that dashed the strip's alpha / IR
 * in plan 13 and the rail's Alpha (ann) in plan 14).
 *
 * One reported test per cell. Row labels repeat across panels (Skew, VaR 95%, CVaR 95%, Profit
 * Factor, Sharpe, Sortino, Max Drawdown), so cells are read panel-scoped, never by a
 * container-wide label lookup. Every case pairs a Dated premise (the same cell carries a digit
 * under the same comparator) with the Withheld assertion, so the dash is the verdict and not a
 * blanket dash, and so the assertion cannot be vacuous.
 */
describe("D-15 extended again: Dash all of them", () => {
  type Case = {
    id: string;
    /** Panel title (the `h3` text starts with it). */
    panel: string;
    /** Exact text of the row's first cell. */
    row: string;
    /** Zero-based td index inside the row. */
    col: number;
    /** A bootstrap CI cell: its Withheld form is "[—, —]". */
    ci?: true;
  };
  /** A cell reduced to extracted strings: RTL cleanup empties containers, so nodes are never stored. */
  type Cell = { text: string; cls: string; style: string } | { error: string };

  function panelSection(container: HTMLElement, title: string): HTMLElement | string {
    const hits = [...container.querySelectorAll<HTMLElement>("section")].filter((s) =>
      (s.querySelector(":scope > header h3")?.textContent ?? "").trim().startsWith(title),
    );
    return hits.length === 1 ? hits[0] : `${hits.length} panels titled "${title}"`;
  }

  function readCell(container: HTMLElement, c: Case): Cell {
    const section = panelSection(container, c.panel);
    if (typeof section === "string") return { error: section };
    const trs = [...section.querySelectorAll<HTMLTableRowElement>("tr")].filter(
      (tr) => (tr.querySelector("td")?.textContent ?? "").trim() === c.row,
    );
    if (trs.length !== 1) return { error: `${trs.length} rows "${c.row}" in "${c.panel}"` };
    const td = trs[0].querySelectorAll<HTMLElement>("td")[c.col];
    if (!td) return { error: `no td ${c.col} in "${c.row}"` };
    return { text: (td.textContent ?? "").trim(), cls: td.className, style: td.getAttribute("style") ?? "" };
  }

  /** Section IV, all nine joint rows (A54 to A62), strategy column. */
  const JOINT_ROWS = [
    "Alpha (ann)",
    "Beta",
    "Correlation",
    "R²",
    "Information Ratio",
    "Treynor",
    "Tracking Error",
    "Up Capture",
    "Down Capture",
  ] as const;
  const JOINT_CASES: Case[] = JOINT_ROWS.map((row, i) => ({ id: `A${54 + i}`, panel: "Joint Metrics", row, col: 1 }));

  /**
   * The first test to call a memoised snapshot renders two whole rails (and, for the window
   * cases, two zooms). RTL's automatic cleanup runs when a test ends, and would empty the
   * containers under a snapshot still being read if that test timed out first, which turned a
   * slow machine into 62 spurious "0 panels" failures. So those tests get a generous timeout.
   */
  const SNAPSHOT_TIMEOUT_MS = 120_000;

  /** Cases for (panel, rows): one per (row, col), ids numbered from `from`, row-major. */
  const grid = (from: number, panel: string, rows: readonly string[], cols: readonly number[]): Case[] =>
    rows.flatMap((row, i) => cols.map((col, j) => ({ id: `A${from + i * cols.length + j}`, panel, row, col })));

  /** A1 to A2: Main Metrics Skew and Kurtosis (strategy). */
  const MAIN_CASES = grid(1, "Main Metrics", ["Skew", "Kurtosis"], [1]);
  /** A3 to A6: Returns Win Rate and Profit Factor, strategy then benchmark. */
  const RETURNS_CASES = grid(3, "Returns", ["Win Rate (days)", "Profit Factor"], [1, 2]);
  /** A7 to A8: Longest DD (days), strategy then benchmark. A9 to A12: VaR, CVaR, Avg Win, Avg Loss (strategy). */
  const MAXDD_CASES = [
    ...grid(7, "Max Drawdown", ["Longest DD (days)"], [1, 2]),
    ...grid(9, "Max Drawdown", ["VaR 95%", "CVaR 95%", "Avg Win", "Avg Loss"], [1]),
  ];
  /** A13 to A22: Best and Worst for Day, Week, Month, Quarter, Year. */
  const BEST_WORST_CASES = grid(13, "Best / Worst Period", ["Day", "Week", "Month", "Quarter", "Year"], [1, 2]);
  /** A23 to A31: Rolling Metrics Avg, Min, Max ("Now", td 1, is pinned by D5 below: it reads "—" too, plan 15 review WR-02). */
  const ROLLING_CASES = grid(23, "Rolling Metrics", ["Volatility", "Sharpe", "Sortino"], [2, 3, 4]);
  /** A32 to A37: Bootstrap Point (td 1) and 95% CI (td 2) for Sharpe, Sortino, Max Drawdown. */
  const BOOTSTRAP_CASES: Case[] = ["Sharpe", "Sortino", "Max Drawdown"].flatMap((row, i) => [
    { id: `A${32 + i * 2}`, panel: "Bootstrap 95% Confidence", row, col: 1 },
    { id: `A${33 + i * 2}`, panel: "Bootstrap 95% Confidence", row, col: 2, ci: true as const },
  ]);
  /** A39 to A53: all fifteen Extended Metrics rows (strategy). */
  const EXTENDED_CASES = grid(
    39,
    "Extended Metrics",
    [
      "Skew",
      "Kurtosis (excess)",
      "VaR 95%",
      "CVaR 95%",
      "P5 (daily)",
      "P95 (daily)",
      "Median (daily)",
      "Profit Factor",
      "Omega (θ=0)",
      "Tail Ratio (P95/|P5|)",
      "Common-sense Ratio",
      "Recovery Factor",
      "Pain Index",
      "Ulcer Index",
      "Avg Win / Avg Loss",
    ],
    [1],
  );

  const CASES: Case[] = [
    ...MAIN_CASES,
    ...RETURNS_CASES,
    ...MAXDD_CASES,
    ...BEST_WORST_CASES,
    ...ROLLING_CASES,
    ...BOOTSTRAP_CASES,
    ...EXTENDED_CASES,
    ...JOINT_CASES,
  ];

  /** Both renders, once, first called from inside a test so the file's localStorage stub is in place. */
  let snapshot: { dated: Map<string, Cell>; withheld: Map<string, Cell> } | null = null;
  function snapshots() {
    if (!snapshot) {
      const take = (p: FactsheetPayload) => {
        const { container, unmount } = renderColumn(p);
        const cells = new Map<string, Cell>();
        for (const c of CASES) cells.set(c.id, readCell(container, c));
        unmount();
        return cells;
      };
      snapshot = {
        dated: take(payloadWithComparator(DATED)),
        withheld: take(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ))),
      };
    }
    return snapshot;
  }

  it.each(CASES)("$id: $panel / $row (td $col) reads the em-dash with no tone on a Withheld row; a Dated row keeps a digit", (c) => {
    const dated = snapshots().dated.get(c.id)!;
    const withheld = snapshots().withheld.get(c.id)!;
    if ("error" in dated) throw new Error(`premise: Dated read failed: ${dated.error}`);
    if ("error" in withheld) throw new Error(`Withheld read failed: ${withheld.error}`);
    expect(dated.text, "premise: the Dated cell carries a digit").toMatch(/\d/);
    expect(withheld.text).toBe(c.ci ? "[—, —]" : "—");
    expect(withheld.cls).not.toContain("text-accent");
    expect(withheld.style).not.toContain("--color-positive");
    expect(withheld.style).not.toContain("--color-negative");
  }, SNAPSHOT_TIMEOUT_MS);

  describe("WR-03 (plan 15 review): the gate's basis term, `railBasis`", () => {
    function takeUnder(basis: Basis, payload: FactsheetPayload) {
      const { container, unmount } = render(
        <FactsheetProvider payload={payload} persist={false}>
          <BasisProvider>
            <SetBasis basis={basis} />
            <MetricsColumn />
          </BasisProvider>
        </FactsheetProvider>,
      );
      const cells = new Map<string, Cell>();
      for (const c of CASES) cells.set(c.id, readCell(container, c));
      const text = container.textContent ?? "";
      unmount();
      return { cells, text };
    }

    it("under mark_to_market none of the 62 whole-record cells dashes on a Withheld row, and no Withheld note shows; under cash the same payload dashes every one", () => {
      const payload = withheldWithMtm();
      // Premise: the very same payload under cash IS the redacted render, so the MTM assertion
      // below cannot pass by the cells never having been withheld in the first place.
      const cash = takeUnder("cash_settlement", payload);
      for (const c of CASES) {
        const cell = cash.cells.get(c.id)!;
        if ("error" in cell) throw new Error(`premise: cash read failed: ${cell.error}`);
        expect(cell.text, `premise: cash ${c.id}`).toBe(c.ci ? "[—, —]" : "—");
      }
      expect(cash.text, "premise: the cash render shows the Withheld note").toContain("Headline figures withheld");
      const mtm = takeUnder("mark_to_market", payload);
      expect(mtm.text).not.toContain("Headline figures withheld");
      for (const c of CASES) {
        const cell = mtm.cells.get(c.id)!;
        if ("error" in cell) throw new Error(`MTM read failed: ${cell.error}`);
        expect(cell.text, `MTM ${c.id}: ${c.panel} / ${c.row} (td ${c.col}) keeps its figure`).toMatch(/\d/);
      }
    }, SNAPSHOT_TIMEOUT_MS);
  });

  it("the case table covers A1 to A62 once each, except A38 (the sparklines, below)", () => {
    const ids = CASES.map((c) => c.id).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
    const expected = Array.from({ length: 62 }, (_, i) => `A${i + 1}`).filter((id) => id !== "A38");
    expect(ids).toEqual(expected);
  });

  it("A38: the Withheld bootstrap panel prints no figure in its table body or its three sparkline readouts; a Dated panel does", () => {
    // Everything after the panel's `table` is the three `BootHist` blocks and the resample
    // footer. The `h3` and the `thead` (its unchanged "95% CI" header) are not figures.
    function figures(p: FactsheetPayload): { body: string; after: string } {
      const { container, unmount } = renderColumn(p);
      const section = panelSection(container, "Bootstrap 95% Confidence");
      if (typeof section === "string") throw new Error(section);
      const table = section.querySelector("table")!;
      const body = table.querySelector("tbody")!.textContent ?? "";
      let after = "";
      for (let n = table.nextElementSibling; n; n = n.nextElementSibling) after += n.textContent ?? "";
      unmount();
      return { body, after };
    }
    const dated = figures(payloadWithComparator(DATED));
    expect(dated.body, "premise: the Dated table body carries a digit").toMatch(/\d/);
    expect(dated.after, "premise: the Dated sparkline readouts carry a digit").toMatch(/\d/);
    const withheld = figures(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    expect(withheld.body).not.toMatch(/\d/);
    expect(withheld.after).not.toMatch(/\d/);
  });

  /** The same two renders inside a selected window (D-78), memoised like `snapshots`. */
  let zoomedSnapshot: Promise<{ dated: Map<string, Cell>; withheld: Map<string, Cell> }> | null = null;
  function Zoom({ range }: { range: [number, number] }) {
    const { setXRange } = useXRange();
    return (
      <button data-testid="zoom" onClick={() => setXRange(range)}>
        zoom
      </button>
    );
  }
  async function zoomedColumn(payload: FactsheetPayload) {
    const view = render(
      <FactsheetProvider payload={payload} persist={false}>
        <Zoom range={[10, 300]} />
        <MetricsColumn />
      </FactsheetProvider>,
    );
    await act(async () => {
      fireEvent.click(view.container.querySelector('[data-testid="zoom"]')!);
    });
    return view;
  }
  function zoomedSnapshots() {
    zoomedSnapshot ??= (async () => {
      const take = async (p: FactsheetPayload) => {
        const { container, unmount } = await zoomedColumn(p);
        const cells = new Map<string, Cell>();
        for (const c of CASES) cells.set(c.id, readCell(container, c));
        unmount();
        return cells;
      };
      return {
        dated: await take(payloadWithComparator(DATED)),
        withheld: await take(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ))),
      };
    })();
    return zoomedSnapshot;
  }

  it.each(CASES)("window exemption (D-78) $id: $panel / $row (td $col) keeps its slice figure inside a selected range on a Withheld row", async (c) => {
    const { dated, withheld } = await zoomedSnapshots();
    const d = dated.get(c.id)!;
    const w = withheld.get(c.id)!;
    if ("error" in d) throw new Error(`premise: Dated zoomed read failed: ${d.error}`);
    if ("error" in w) throw new Error(`Withheld zoomed read failed: ${w.error}`);
    expect(d.text, "premise: the Dated slice cell carries a digit, so the assertion below cannot be vacuous").toMatch(/\d/);
    expect(w.text, "the window keeps the slice figure").toMatch(/\d/);
  }, SNAPSHOT_TIMEOUT_MS);

  it("window exemption (D-78) A38: the bootstrap table body and sparkline readouts keep their figures inside a selected range", async () => {
    async function figures(p: FactsheetPayload): Promise<{ body: string; after: string }> {
      const { container, unmount } = await zoomedColumn(p);
      const section = panelSection(container, "Bootstrap 95% Confidence");
      if (typeof section === "string") throw new Error(section);
      const table = section.querySelector("table")!;
      const body = table.querySelector("tbody")!.textContent ?? "";
      let after = "";
      for (let n = table.nextElementSibling; n; n = n.nextElementSibling) after += n.textContent ?? "";
      unmount();
      return { body, after };
    }
    const dated = await figures(payloadWithComparator(DATED));
    expect(dated.body, "premise: the Dated slice table body carries a digit").toMatch(/\d/);
    expect(dated.after, "premise: the Dated slice readouts carry a digit").toMatch(/\d/);
    const withheld = await figures(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));
    expect(withheld.body).toMatch(/\d/);
    expect(withheld.after).toMatch(/\d/);
  }, SNAPSHOT_TIMEOUT_MS);

  describe("kept cells (over-dash guard): dates, record length and per-period entries keep their digits on a Withheld full-history row", () => {
    const rowsOf = (container: HTMLElement, panel: string): HTMLTableRowElement[] => {
      const section = panelSection(container, panel);
      if (typeof section === "string") throw new Error(`premise: ${section}`);
      return [...section.querySelectorAll<HTMLTableRowElement>("tbody tr")];
    };
    const render1 = () => renderColumn(withHeadlineNaN(payloadWithComparator(WITHHELD_DQ)));

    it("C2 to C4: Start Date, End Date and Years Observed", () => {
      const { container } = render1();
      for (const row of ["Start Date", "End Date", "Years Observed"]) {
        const cell = readCell(container, { id: row, panel: "Compound Performance", row, col: 1 });
        if ("error" in cell) throw new Error(cell.error);
        expect(cell.text, row).toMatch(/\d/);
      }
    });

    it("D1: every EOY Returns year row EXCEPT the record's last keeps its strategy figure", () => {
      // Flipped deliberately (plan 15 review WR-01, founder 2026-10-15 "fix the medium
      // user-facing issues"): the last year is the Year-to-date figure, which the Returns panel
      // dashes on a Withheld row. It reads "—" (pinned in the WR-01 test below). Every EARLIER
      // year covers its own calendar year and keeps its figure.
      const { container } = render1();
      const rows = rowsOf(container, "EOY Returns");
      expect(rows.length, "premise: the EOY panel renders year rows").toBeGreaterThan(1);
      for (const tr of rows.slice(0, -1)) {
        const tds = tr.querySelectorAll("td");
        expect(tds[0].textContent).toMatch(/^\d{4}$/);
        expect(tds[1].textContent, `EOY ${tds[0].textContent}`).toMatch(/\d/);
      }
    });

    it("D4: every Calmar by Year row EXCEPT the record's last keeps its Return figure", () => {
      // Flipped deliberately with D1 (plan 15 review WR-01): the last year's Return is the
      // Year-to-date figure.
      const { container } = render1();
      const rows = rowsOf(container, "Calmar by Year");
      expect(rows.length, "premise: the Calmar panel renders year rows").toBeGreaterThan(1);
      for (const tr of rows.slice(0, -1)) {
        const tds = tr.querySelectorAll("td");
        expect(tds[1].textContent, `Calmar ${tds[0].textContent}`).toMatch(/\d/);
      }
    });

    it("WR-01: the record's last calendar year IS the Year-to-date figure; on a Withheld row it reads the em-dash in EOY Returns and Calmar by Year, on a clean row it carries the same digits", () => {
      const ytd = (c: HTMLElement) => {
        const cell = readCell(c, { id: "ytd", panel: "Returns", row: "Year-to-date", col: 1 });
        if ("error" in cell) throw new Error(cell.error);
        return cell.text;
      };
      const lastRow = (c: HTMLElement, panel: string) => {
        const rows = rowsOf(c, panel);
        return [...rows[rows.length - 1].querySelectorAll("td")].map((td) => ({
          text: (td.textContent ?? "").trim(),
          cls: td.className,
          style: td.getAttribute("style") ?? "",
        }));
      };
      // Premise, the clean row: EOY's last strategy cell and Calmar's last Return cell repeat
      // the Returns panel's Year-to-date figure digit for digit.
      const clean = renderColumn(payloadWithComparator(CLEAN));
      const cleanYtd = ytd(clean.container);
      expect(cleanYtd, "premise: a clean row prints a YTD figure").toMatch(/\d/);
      const cleanEoy = lastRow(clean.container, "EOY Returns");
      const cleanCalmar = lastRow(clean.container, "Calmar by Year");
      expect(cleanEoy[1].text, "premise: EOY's last year is the YTD figure").toBe(cleanYtd);
      expect(cleanCalmar[1].text, "premise: Calmar's last Return is the YTD figure").toBe(cleanYtd);
      expect(cleanEoy[2].text, "premise: the clean benchmark cell carries a digit").toMatch(/\d/);
      expect(cleanEoy[3].text, "premise: the clean delta cell carries a digit").toMatch(/\d/);
      expect(cleanCalmar[2].text, "premise: the clean Max DD cell carries a digit").toMatch(/\d/);
      expect(cleanCalmar[3].text, "premise: the clean Calmar cell carries a digit").toMatch(/\d/);
      clean.unmount();
      // The verdict, the Withheld row: YTD reads "—", and so does every cell that repeats it,
      // with no tone. The year label and the day count are not figures and stay.
      // As the read path builds it: `withSuffixWindows` nulls the seven trailing windows too
      // (`withHeadlineNaN` only does the seven stored scalars), so YTD is null.
      const built = withHeadlineNaN(payloadWithComparator(WITHHELD_DQ));
      const asBuilt = {
        ...built,
        strategyMetrics: { ...built.strategyMetrics, mtd: null, ytd: null, p3m: null, p6m: null, p1y: null, p3y: null, p5y: null },
      } as FactsheetPayload;
      const w = renderColumn(asBuilt);
      expect(ytd(w.container), "premise: the Returns panel dashes YTD on a Withheld row").toBe("—");
      const eoy = lastRow(w.container, "EOY Returns");
      const calmar = lastRow(w.container, "Calmar by Year");
      expect(eoy[0].text).toBe(cleanEoy[0].text);
      for (const cell of [eoy[1], eoy[2], eoy[3], calmar[1], calmar[2], calmar[3]]) {
        expect(cell.text).toBe("—");
        expect(cell.style).not.toContain("--color-positive");
        expect(cell.style).not.toContain("--color-negative");
      }
      expect(calmar[4].text, "the day count is not a figure").toMatch(/^\d+$/);
      w.unmount();
    });

    it("R3-WR-01 (round-2 review): inside a zoom, the last EOY and Calmar year stay dashed on a Withheld row, because both panels show the full history", async () => {
      // Plan 15 round 3, WR-01 (regression from 3194279bf): the two panels read the full-history
      // view and say "Full history" inside a zoom, so the slice-aware gate (`!selected`) must not
      // switch their dash off. The rail's own slice figures keep the slice-aware gate (D-78, the
      // window exemption above). Built as the read path builds it (YTD and the windows nulled).
      const built = withHeadlineNaN(payloadWithComparator(WITHHELD_DQ));
      const asBuilt = {
        ...built,
        strategyMetrics: { ...built.strategyMetrics, mtd: null, ytd: null, p3m: null, p6m: null, p1y: null, p3y: null, p5y: null },
      } as FactsheetPayload;
      const lastRow = (c: HTMLElement, panel: string) => {
        const rows = rowsOf(c, panel);
        return [...rows[rows.length - 1].querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());
      };
      // Premise A: a clean row inside the same zoom prints digits in every last-year cell, so the
      // dash below is the Withheld verdict and not an artefact of the zoom.
      const clean = await zoomedColumn(payloadWithComparator(CLEAN));
      const cleanEoy = lastRow(clean.container, "EOY Returns");
      const cleanCalmar = lastRow(clean.container, "Calmar by Year");
      for (const t of [cleanEoy[1], cleanEoy[2], cleanEoy[3], cleanCalmar[1], cleanCalmar[2], cleanCalmar[3]]) {
        expect(t, "premise: a clean zoomed last-year cell carries a digit").toMatch(/\d/);
      }
      clean.unmount();
      // Premise B: the zoom is real on the Withheld row, the rail's Returns panel keeps its slice figure.
      const w = await zoomedColumn(asBuilt);
      const skew = readCell(w.container, { id: "A1", panel: "Main Metrics", row: "Skew", col: 1 });
      if ("error" in skew) throw new Error(skew.error);
      expect(skew.text, "premise: the zoom keeps the rail's slice figure (window exemption A1)").toMatch(/\d/);
      const eoy = lastRow(w.container, "EOY Returns");
      const calmar = lastRow(w.container, "Calmar by Year");
      expect(eoy[0]).toBe(cleanEoy[0]);
      for (const t of [eoy[1], eoy[2], eoy[3], calmar[1], calmar[2], calmar[3]]) expect(t).toBe("—");
      // Earlier years keep their figures inside the zoom too (they cover their own calendar year).
      for (const tr of rowsOf(w.container, "EOY Returns").slice(0, -1)) {
        expect(tr.querySelectorAll("td")[1].textContent, "earlier EOY year").toMatch(/\d/);
      }
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);

    it('D5: the three Rolling Metrics "Now" cells read the em-dash with no accent', () => {
      // Flipped deliberately (plan 15 review WR-02, founder 2026-10-15): "Now" is the trailing
      // 6-month window, the span whose 6 Month return the Returns panel dashes on a Withheld row
      // (a trailing window can straddle the undated break). Premise: a clean row carries a digit.
      const clean = renderColumn(payloadWithComparator(CLEAN));
      for (const row of ["Volatility", "Sharpe", "Sortino"]) {
        const cell = readCell(clean.container, { id: row, panel: "Rolling Metrics", row, col: 1 });
        if ("error" in cell) throw new Error(cell.error);
        expect(cell.text, `premise: clean Now ${row}`).toMatch(/\d/);
      }
      clean.unmount();
      const { container } = render1();
      for (const row of ["Volatility", "Sharpe", "Sortino"]) {
        const cell = readCell(container, { id: row, panel: "Rolling Metrics", row, col: 1 });
        if ("error" in cell) throw new Error(cell.error);
        expect(cell.text, `Now: ${row}`).toBe("—");
        expect(cell.cls, `Now: ${row}`).not.toContain("text-accent");
      }
    });

    it("D6: the Worst 10 Drawdowns table keeps at least one Depth figure", () => {
      const { container } = render1();
      const rows = rowsOf(container, "Worst 10 Drawdowns");
      expect(rows.length, "premise: the Worst 10 table renders rows").toBeGreaterThan(0);
      expect(rows.some((tr) => /\d/.test(tr.querySelectorAll("td")[4]?.textContent ?? ""))).toBe(true);
    });
  });

  describe("the rail states one cause: the flat-leg line", () => {
    const railFlatLegLines = (container: HTMLElement) =>
      container.querySelectorAll('[data-testid="joint-flat-leg-reason"]');

    it("a Dated flat-leg rail shows the one reason line (premise)", () => {
      const { container } = renderColumn(flatPayload(DATED));
      expect(railFlatLegLines(container)).toHaveLength(1);
    });

    it("a Withheld flat-leg rail shows no second cause beside the Withheld note, and its nine joint rows read the em-dash", () => {
      const { container } = renderColumn(withHeadlineNaN(flatPayload(WITHHELD_DQ)));
      expect(railFlatLegLines(container)).toHaveLength(0);
      for (const row of JOINT_ROWS) {
        const cell = readCell(container, { id: row, panel: "Joint Metrics", row, col: 1 });
        if ("error" in cell) throw new Error(cell.error);
        expect(cell.text, row).toBe("—");
      }
    });
  });
});

/**
 * Plan 15 round 3 (founder rule 2026-10-15: user-facing and data-integrity MEDIUMs are fixed,
 * not booked; review R2 WR-02 to WR-04). The Year-to-date figure the Returns panel dashes on a
 * Withheld row is also printed by four charts and tables outside the rail. On a Withheld row at
 * FULL history (the rail's own gate, D-78) none of them may print it. Every case pairs a Dated or
 * clean premise (the same surface prints it) with the Withheld verdict, so the dash is the
 * verdict and the assertion cannot be vacuous. Not dashed: a Dated row, mark-to-market, and the
 * rail's earlier years.
 */
describe("plan 15 round 3: the Year-to-date copies outside the rail", () => {
  /** Whole-body renders are slow on a loaded machine; see the rail snapshots above. */
  const SNAPSHOT_TIMEOUT_MS = 120_000;
  /** The Withheld payload as the read path builds it: the seven scalars and the windows nulled. */
  function asBuilt(dq: DQ, overrides?: (p: FactsheetPayload) => Partial<FactsheetPayload["strategyMetrics"]>): FactsheetPayload {
    const built = withHeadlineNaN(payloadWithComparator(dq));
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
  const WITHHELD = (overrides?: Parameters<typeof asBuilt>[1]) => asBuilt(WITHHELD_DQ, overrides);

  /** Mounts the whole body and flushes the next/dynamic loaders (the Monthly Returns heatmap). */
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
        <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
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
  function figureTitled(container: HTMLElement, title: string): HTMLElement {
    const hits = [...container.querySelectorAll<HTMLElement>("figure")].filter((f) =>
      (f.querySelector("h3")?.textContent ?? "").trim().startsWith(title),
    );
    if (hits.length !== 1) throw new Error(`${hits.length} figures titled "${title}"`);
    return hits[0];
  }

  describe("WR-02: the End-of-Year Returns bar chart", () => {
    /** The row group of `year`: its texts (year label first) and how many bars it draws. */
    function eoyRow(container: HTMLElement, year: string) {
      const fig = figureTitled(container, "End-of-Year Returns");
      const g = [...fig.querySelectorAll("g")].find((n) => n.querySelector(":scope > text")?.textContent === year);
      if (!g) throw new Error(`no EOY chart row for ${year}`);
      return {
        texts: [...g.querySelectorAll("text")].map((t) => t.textContent ?? ""),
        bars: g.querySelectorAll("rect").length,
        caption: fig.querySelector("header p")?.textContent ?? "",
      };
    }
    // The last year's return is set far above every other year so the scale caption encodes it
    // whenever the chart still counts that year.
    const HUGE = (p: FactsheetPayload) => ({ yearly: { ...p.strategyMetrics.yearly, [lastYearOf(p)]: 9 } });

    it("a Withheld row at full history prints no last-year label, bar or scale for that year; earlier years keep theirs", async () => {
      const clean = payloadWithComparator(CLEAN);
      const year = lastYearOf(clean);
      const cleanView = await mountBody({
        ...clean,
        strategyMetrics: { ...clean.strategyMetrics, yearly: { ...clean.strategyMetrics.yearly, [year]: 9 } },
      } as FactsheetPayload);
      const cleanRow = eoyRow(cleanView.container, year);
      // Premise: the same surface prints the year's strategy and benchmark labels, a bar, and the scale.
      expect(cleanRow.texts.length, "premise: year label plus strategy and benchmark labels").toBeGreaterThanOrEqual(3);
      expect(cleanRow.bars, "premise: the year draws bars").toBeGreaterThan(0);
      expect(cleanRow.caption, "premise: the scale caption encodes the huge last year").toContain("±900%");
      const prevYear = String(Number(year) - 1);
      const cleanPrev = eoyRow(cleanView.container, prevYear);
      cleanView.unmount();

      const w = await mountBody(WITHHELD(HUGE));
      const row = eoyRow(w.container, year);
      expect(row.texts, "only the year label remains").toEqual([year]);
      expect(row.bars, "no bar encodes the withheld figure").toBe(0);
      expect(row.caption, "the scale caption leaves that year out").not.toContain("±900%");
      const prev = eoyRow(w.container, prevYear);
      expect(prev.texts, "an earlier year keeps its labels").toEqual(cleanPrev.texts);
      expect(prev.bars).toBeGreaterThan(0);
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);

    it("a Dated row keeps the last year's labels and bars", async () => {
      const dated = await mountBody(asBuilt(DATED, HUGE));
      const row = eoyRow(dated.container, lastYearOf(payloadWithComparator(DATED)));
      expect(row.texts.length).toBeGreaterThanOrEqual(3);
      expect(row.bars).toBeGreaterThan(0);
      expect(row.caption).toContain("±900%");
      dated.unmount();
    }, SNAPSHOT_TIMEOUT_MS);
  });
  describe("WR-03: the Monthly Returns heatmap's YTD column", () => {
    /** The last row of the heatmap, as extracted strings: its YTD cell and its month cells. */
    function lastHeatmapRow(container: HTMLElement) {
      const fig = figureTitled(container, "Monthly Returns");
      const trs = [...fig.querySelectorAll<HTMLTableRowElement>("tbody tr")];
      const tds = [...trs[trs.length - 1].querySelectorAll("td")];
      const ytd = tds[tds.length - 1];
      return {
        year: (tds[0].textContent ?? "").trim(),
        rows: trs.length,
        ytd: (ytd.textContent ?? "").trim(),
        ytdStyle: ytd.getAttribute("style") ?? "",
        months: tds.slice(1, -1).map((td) => (td.textContent ?? "").trim()),
        monthTitles: tds.slice(1, -1).map((td) => td.getAttribute("title") ?? ""),
        monthStyles: tds.slice(1, -1).map((td) => td.getAttribute("style") ?? ""),
      };
    }

    it("a Withheld row at full history dashes the last row's YTD cell and its last month cell with no tone; earlier rows and every earlier month cell keep their figures", async () => {
      const clean = await mountBody(payloadWithComparator(CLEAN));
      const c = lastHeatmapRow(clean.container);
      // Premise: the same surface prints a toned YTD figure for the last year, on a clean row.
      expect(c.ytd, "premise: a clean row prints the YTD figure").toMatch(/\d/);
      expect(c.ytdStyle, "premise: the clean YTD cell carries a tone").toMatch(/--color-(positive|negative)/);
      expect(c.rows, "premise: more than one year row").toBeGreaterThan(1);
      // Premise: the last month cell (the last month that holds data) IS the Returns panel's
      // Month-to-date figure, to 2 dp, so dashing the one dashes a copy of the other.
      const lastIdx = c.months.map((t) => t !== "·").lastIndexOf(true);
      expect(lastIdx, "premise: the last row has a month with data").toBeGreaterThanOrEqual(0);
      expect(c.months[lastIdx], "premise: a clean row prints the last month's figure").toMatch(/\d/);
      expect(c.monthStyles[lastIdx], "premise: the clean last month cell is tinted").toMatch(/background/);
      const returnsPanels = [...clean.container.querySelectorAll<HTMLElement>("section")].filter(
        (sec) => (sec.querySelector(":scope > header h3")?.textContent ?? "").trim() === "Returns",
      );
      expect(returnsPanels, "premise: exactly one Returns panel").toHaveLength(1);
      const mtdRow = [...returnsPanels[0].querySelectorAll<HTMLTableRowElement>("tbody tr")].find((tr) =>
        /^(Month-to-date|Last month|Final month)/.test((tr.querySelector("td")?.textContent ?? "").trim()),
      );
      expect(mtdRow, "premise: the Returns panel has a month row").toBeDefined();
      const num = (t: string) => Number.parseFloat(t.replace("\u2212", "-").replace(/[^0-9.+-]/g, ""));
      const titleFigure = num(c.monthTitles[lastIdx].split(": ")[1]);
      expect(titleFigure, "premise: the cell's figure equals the Returns panel's Month-to-date to 2 dp").toBeCloseTo(
        num(mtdRow!.querySelectorAll("td")[1].textContent ?? ""),
        2,
      );
      const cleanEarlier = [...figureTitled(clean.container, "Monthly Returns").querySelectorAll("tbody tr")]
        .slice(0, -1)
        .map((tr) => (tr.querySelector("td:last-child")?.textContent ?? "").trim());
      clean.unmount();

      const w = await mountBody(WITHHELD());
      const row = lastHeatmapRow(w.container);
      expect(row.year).toBe(c.year);
      expect(row.ytd).toBe("—");
      expect(row.ytdStyle).not.toContain("--color-positive");
      expect(row.ytdStyle).not.toContain("--color-negative");
      // Flipped deliberately (round 4, MEDIUM 1, founder rule 2026-10-15): the last month cell IS
      // the Month-to-date figure the Returns panel dashes, so it reads "—" with no tone and no
      // figure in its title. Round 3 pinned every month cell as a per-period entry and stay; that
      // held for the earlier months only. Earlier month cells in the row keep their figures.
      expect(row.months[lastIdx], "the last month cell is the dashed Month-to-date figure").toBe("—");
      expect(row.monthStyles[lastIdx]).not.toContain("--color-positive");
      expect(row.monthStyles[lastIdx]).not.toContain("--color-negative");
      expect(row.monthStyles[lastIdx], "no tint").not.toBe(c.monthStyles[lastIdx]);
      expect(row.monthTitles[lastIdx], "the title carries no figure").not.toMatch(/\d%|\d\./);
      expect(row.monthTitles[lastIdx]).toBe(`${c.monthTitles[lastIdx].split(": ")[0]}: withheld`);
      expect(row.months.filter((_, i) => i !== lastIdx), "every earlier month cell keeps its figure").toEqual(
        c.months.filter((_, i) => i !== lastIdx),
      );
      expect(row.monthTitles.filter((_, i) => i !== lastIdx)).toEqual(c.monthTitles.filter((_, i) => i !== lastIdx));
      const earlier = [...figureTitled(w.container, "Monthly Returns").querySelectorAll("tbody tr")]
        .slice(0, -1)
        .map((tr) => (tr.querySelector("td:last-child")?.textContent ?? "").trim());
      expect(earlier, "an earlier year keeps its total").toEqual(cleanEarlier);
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);

    it("a Dated row keeps the toned YTD figure", async () => {
      const dated = await mountBody(asBuilt(DATED));
      const row = lastHeatmapRow(dated.container);
      expect(row.ytd).toMatch(/\d/);
      expect(row.ytdStyle).toMatch(/--color-(positive|negative)/);
      expect(row.months.filter((t) => t !== "·").every((t) => /\d/.test(t)), "a Dated row keeps its last month cell").toBe(true);
      expect(row.monthTitles.every((t) => !t.endsWith(": withheld"))).toBe(true);
      dated.unmount();
    }, SNAPSHOT_TIMEOUT_MS);
  });
  describe("WR-04: the rolling charts' avg label", () => {
    /** The "avg ..." labels the three rolling charts draw on the plot. */
    const avgLabels = (container: HTMLElement) =>
      [...container.querySelectorAll("svg text")].map((t) => (t.textContent ?? "").trim()).filter((t) => /^avg\s/.test(t));

    it("a Withheld row at full history draws no avg label; a clean row draws one per rolling chart", async () => {
      const clean = await mountBody(payloadWithComparator(CLEAN));
      // Premise: the same charts print an avg label (vol, Sharpe, Sortino) on a clean row.
      expect(avgLabels(clean.container), "premise: a clean row draws the avg labels").toHaveLength(3);
      clean.unmount();
      const w = await mountBody(WITHHELD());
      expect(avgLabels(w.container)).toEqual([]);
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);

    it("a Dated row keeps the avg labels", async () => {
      const dated = await mountBody(asBuilt(DATED));
      expect(avgLabels(dated.container)).toHaveLength(3);
      dated.unmount();
    }, SNAPSHOT_TIMEOUT_MS);

    it("inside a zoom a Withheld row keeps the avg labels: there each is the visible range's average, a slice figure (D-78)", async () => {
      const w = await mountBody(WITHHELD(), [10, 300]);
      expect(avgLabels(w.container)).toHaveLength(3);
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);

    it("R3-WR-02 (round-3 review): a zoom-out gesture that reaches the whole record draws no avg label while the gesture is held", async () => {
      // The label averages the chart's LIVE range, and the held windowed view lags it: a wheel burst
      // that expands a zoom to the full record keeps the rail on the start slice for
      // WHEEL_SETTLE_MS (an x-gutter drag, for as long as the pointer is held). The gate must read
      // the live range, or the whole-record average (the figure the rail dashes) prints meanwhile.
      const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0, top: 0, right: 880, bottom: 280, width: 880, height: 280, x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);
      try {
        const w = await mountBody(WITHHELD(), [10, 300]);
        // Premise A: inside the zoom the three labels print and the rail is on the slice.
        expect(avgLabels(w.container), "premise: the zoom keeps the labels").toHaveLength(3);
        expect(w.container.querySelector('[data-testid="window-trailing-note"]'), "premise: the rail is on the slice").not.toBeNull();
        const svg = [...w.container.querySelectorAll<SVGSVGElement>("svg")].find((n) =>
          (n.getAttribute("aria-label") ?? "").startsWith("Rolling Volatility"),
        );
        expect(svg, "premise: the Rolling Volatility chart is mounted").toBeDefined();
        // A single huge zoom-out tick reaches [0, n - 1] and holds the range it started on. The
        // settle timer is faked so a slow runner cannot release the hold mid-assertion.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        await act(async () => {
          fireEvent.wheel(svg!, { deltaY: 100_000, clientX: 400, clientY: 100 });
        });
        // Premise B: the gesture is still held, so the windowed view (the rail) has NOT moved off the slice.
        expect(
          w.container.querySelector('[data-testid="window-trailing-note"]'),
          "premise: the hold is in effect, the rail still shows the start slice",
        ).not.toBeNull();
        expect(avgLabels(w.container), "no whole-record avg while the gesture is held").toEqual([]);
        // Settled at the whole record: the rail has left the slice, and the labels are still gone.
        await act(async () => {
          vi.advanceTimersByTime(WHEEL_SETTLE_MS + 10);
        });
        expect(w.container.querySelector('[data-testid="window-trailing-note"]'), "premise: the hold released").toBeNull();
        expect(avgLabels(w.container)).toEqual([]);
        w.unmount();
      } finally {
        vi.useRealTimers();
        rect.mockRestore();
      }
    }, SNAPSHOT_TIMEOUT_MS);
  });
  describe("scope: the copies follow the rail's dash at full history only, never a Dated row or mark-to-market", () => {
    /** Every surface that repeats the Year-to-date figure, reduced to strings. */
    function readCopies(container: HTMLElement, year: string) {
      const lastRailRow = (panel: string) => {
        const hits = [...container.querySelectorAll<HTMLElement>("section")].filter((sec) =>
          (sec.querySelector(":scope > header h3")?.textContent ?? "").trim().startsWith(panel),
        );
        if (hits.length !== 1) throw new Error(`${hits.length} panels titled "${panel}"`);
        const trs = [...hits[0].querySelectorAll("tbody tr")];
        return [...trs[trs.length - 1].querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());
      };
      const fig = figureTitled(container, "End-of-Year Returns");
      const barRow = [...fig.querySelectorAll("g")].find((n) => n.querySelector(":scope > text")?.textContent === year);
      const heat = figureTitled(container, "Monthly Returns");
      const heatTds = [...heat.querySelectorAll("tbody tr:last-child td")];
      return {
        eoy: lastRailRow("EOY Returns"),
        calmar: lastRailRow("Calmar by Year"),
        barTexts: [...(barRow?.querySelectorAll("text") ?? [])].map((t) => t.textContent ?? ""),
        heatYtd: (heatTds[heatTds.length - 1].textContent ?? "").trim(),
        avg: [...container.querySelectorAll("svg text")].map((t) => (t.textContent ?? "").trim()).filter((t) => /^avg\s/.test(t)),
      };
    }

    it("under mark_to_market none of the copies dashes on a Withheld row; under cash the same payload dashes the four YTD copies and the rolling avg", async () => {
      const payload = withheldWithMtm();
      const year = lastYearOf(payload);
      async function take(basis: Basis) {
        const view = render(
          <FactsheetProvider payload={payload} persist={false}>
            <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
          </FactsheetProvider>,
        );
        // FactsheetBody mounts its own BasisProvider, so the basis is switched the way a reader does.
        if (basis === "mark_to_market") {
          await act(async () => {
            fireEvent.click(within(view.container).getByText("Mark-to-market"));
          });
        }
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
        const copies = readCopies(view.container, year);
        view.unmount();
        return copies;
      }
      // Premise: the very same payload under cash IS the redacted render, so the MTM
      // assertions below cannot pass by the copies never having been withheld.
      const cash = await take("cash_settlement");
      for (const t of [cash.eoy[1], cash.eoy[2], cash.eoy[3], cash.calmar[1], cash.calmar[2], cash.calmar[3], cash.heatYtd]) {
        expect(t, "premise: cash dashes the copy").toBe("—");
      }
      expect(cash.barTexts, "premise: cash drops the chart labels").toEqual([year]);
      expect(cash.avg, "premise: cash drops the avg labels").toEqual([]);
      const mtm = await take("mark_to_market");
      for (const t of [mtm.eoy[1], mtm.eoy[2], mtm.eoy[3], mtm.calmar[1], mtm.calmar[2], mtm.calmar[3], mtm.heatYtd]) {
        expect(t, "MTM keeps the copy").toMatch(/\d/);
      }
      expect(mtm.barTexts.length, "MTM keeps the chart labels").toBeGreaterThanOrEqual(2);
      expect(mtm.avg, "MTM keeps the avg labels").toHaveLength(3);
    }, SNAPSHOT_TIMEOUT_MS);

    it("inside a zoom the full-history copies stay dashed on a Withheld row (they show the whole record there too)", async () => {
      const clean = payloadWithComparator(CLEAN);
      const year = lastYearOf(clean);
      const c = await mountBody(clean, [10, 300]);
      const cleanCopies = readCopies(c.container, year);
      expect(cleanCopies.heatYtd, "premise: a clean zoomed row prints the heatmap YTD").toMatch(/\d/);
      expect(cleanCopies.barTexts.length, "premise: a clean zoomed row prints the chart labels").toBeGreaterThanOrEqual(3);
      c.unmount();
      const w = await mountBody(WITHHELD(), [10, 300]);
      // Premise (round 4, LOW): the zoom took effect on the Withheld render. The rail's Returns
      // panel is on the slice (its trailing-window note shows only for a selected range), and the
      // rolling charts keep their avg labels, which a Withheld row drops at full history.
      expect(w.container.querySelector('[data-testid="window-trailing-note"]'), "premise: the rail is on the zoomed slice").not.toBeNull();
      const copies = readCopies(w.container, year);
      expect(copies.avg, "premise: the rolling charts are zoomed (a full-history Withheld render draws none)").toHaveLength(3);
      expect(copies.heatYtd).toBe("—");
      expect(copies.barTexts).toEqual([year]);
      expect(copies.eoy.slice(1, 4)).toEqual(["—", "—", "—"]);
      w.unmount();
    }, SNAPSHOT_TIMEOUT_MS);
  });
});
