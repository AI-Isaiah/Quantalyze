import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import {
  marksStartCaption,
  marksStartLabelRendered,
  marksStartSentenceOne,
  marksStartSentenceThree,
  marksTrailingNote,
} from "@/lib/nav-marks-start";
import { CHART_CONFIGS, type ChartConfig } from "./chart-configs";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

/**
 * Phase 167.2.1.1.1 (NAVMTM) plan 10, D-08: the start-of-marks note on the
 * factsheet's Cumulative Returns chart. Tests (a) to (e) of the approved
 * UI-SPEC ("Host tests must show, with RED first"), on the cumulative config
 * through the FS-01 markers test's harness.
 *
 * Every date here is synthetic. The expected words come from the UI-SPEC
 * Copywriting Contract through the reader's copy functions, and the spec's own
 * sentences are asserted verbatim in `nav-marks-start.test.ts`, so a reworded
 * caption fails in one place with the sentence shown.
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
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DAY = 86_400_000;
const FIRST_DAY = "2026-01-01";
const N = 60;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const DATES = Array.from({ length: N }, (_, i) => addDays(FIRST_DAY, i));
const LAST_DAY = DATES[N - 1];
/** Deterministic, finite, non-zero daily returns. */
const RETURNS = DATES.map((_, i) => 0.002 + Math.sin(i * 0.7) * 0.01);
const START_INSIDE = "2026-02-10"; // index 40
const START_FORMATTED = "Feb 10, 2026";

function points(): DailyPoint[] {
  return DATES.map((date, i) => ({ date, value: RETURNS[i] }));
}

function payloadWith(extra: Record<string, unknown>): FactsheetPayload {
  const base = buildScenarioFactsheetPayload({ portfolioDaily: points(), periodsPerYear: 365 });
  return { ...base, ...extra } as unknown as FactsheetPayload;
}

const cumulativeCfg = CHART_CONFIGS.find((c) => c.key === "cumulative")!;
const cumVsBenchCfg = CHART_CONFIGS.find((c) => c.key === "cumVsBench")!;

/** Sets the basis once on mount, so a test can open the chart under any basis. */
function SetBasis({ basis }: { basis: Basis }) {
  const { setBasis } = useBasis();
  useEffect(() => {
    setBasis(basis);
  }, [basis, setBasis]);
  return null;
}

function ZoomControls() {
  const { setXRange, resetXRange } = useXRange();
  return (
    <>
      <button type="button" data-testid="zoom-past-start" onClick={() => setXRange([45, N - 1])} />
      <button type="button" data-testid="zoom-before-start" onClick={() => setXRange([10, N - 1])} />
      <button type="button" data-testid="reset" onClick={() => resetXRange()} />
    </>
  );
}

function renderChart(payload: FactsheetPayload, config: ChartConfig = cumulativeCfg, basis: Basis = "cash_settlement") {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <SetBasis basis={basis} />
        <ZoomControls />
        <TimeSeriesChart config={config} />
      </BasisProvider>
    </FactsheetProvider>,
  );
}

const MARKER = '[data-testid="marks-start-marker"]';
const NOTE = '[data-testid="marks-start-note"]';

describe("fixture sanity", () => {
  it("the scenario payload draws the dates the tests index into", () => {
    const p = payloadWith({});
    expect(p.dates[0]).toBe(FIRST_DAY);
    expect(p.dates[N - 1]).toBe(LAST_DAY);
    expect(p.dates.indexOf(START_INSIDE)).toBe(40);
  });
});

describe("TimeSeriesChart marks-start note, (a): start inside the drawn range", () => {
  it("draws one solid line, the tracked uppercase label, the <title> S1 and the caption S1 S2", () => {
    const { container } = renderChart(payloadWith({ marksSince: START_INSIDE }));

    const groups = container.querySelectorAll(MARKER);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.getAttribute("pointer-events")).toBe("none");

    const lines = g.querySelectorAll("line");
    expect(lines.length).toBe(1);
    expect(lines[0].hasAttribute("stroke-dasharray")).toBe(false);
    expect(lines[0].getAttribute("stroke")).toBe("var(--color-text-secondary)");
    expect(lines[0].getAttribute("stroke-width")).toBe("1");
    expect(lines[0].getAttribute("x1")).toBe(lines[0].getAttribute("x2"));

    const text = g.querySelector("text");
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe("RECORDED EQUITY FROM FEB 10, 2026");
    expect(text!.textContent).toBe(marksStartLabelRendered(START_FORMATTED));
    expect(text!.getAttribute("letter-spacing")).toBe("0.05em");
    expect(text!.getAttribute("font-size")).toBe("10");
    expect(text!.getAttribute("font-family")).toBe("var(--font-mono)");
    expect(text!.getAttribute("fill")).toBe("var(--color-text-secondary)");
    // The second annotation row (PAD.top + 24 = 44), below the FS-01 labels.
    expect(text!.getAttribute("y")).toBe("44");

    const title = g.querySelector("title");
    expect(title!.textContent).toBe(marksStartSentenceOne(START_FORMATTED));

    const note = container.querySelector(NOTE);
    expect(note).not.toBeNull();
    expect(note!.tagName.toLowerCase()).toBe("figcaption");
    expect(note!.className).toContain("text-caption");
    expect(note!.className).toContain("text-text-secondary");
    expect(note!.textContent).toBe(marksStartCaption(START_FORMATTED, false));
    // It is the figure's last child.
    const figure = note!.closest("figure")!;
    expect(figure.lastElementChild).toBe(note);
  });

  it("the marker sits on the start day's x and inside the plot", () => {
    const { container } = renderChart(payloadWith({ marksSince: START_INSIDE }));
    const line = container.querySelector(`${MARKER} line`)!;
    const x = Number(line.getAttribute("x1"));
    expect(Number.isFinite(x)).toBe(true);
    // 40 of 59 intervals across the plot; the plot lies inside the 880-wide viewBox.
    expect(x).toBeGreaterThan(50);
    expect(x).toBeLessThan(850);
    expect(Number(line.getAttribute("y1"))).toBe(20);
  });
});

describe("TimeSeriesChart marks-start note, (b): none of the three outside the range", () => {
  it.each([
    ["before the first drawn day", "2025-12-15"],
    ["equal to the first drawn day", FIRST_DAY],
    ["after the last drawn day", addDays(LAST_DAY, 3)],
    ["absent", undefined],
    ["null", null],
    ["malformed text", "2026-02-30"],
    ["a malformed number", 20260210],
  ])("start %s draws no line, no label and no caption", (_label, marksSince) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderChart(payloadWith({ marksSince }));
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/recorded equity/i);
  });

  it("a start on the last drawn day still shows the note", () => {
    const { container } = renderChart(payloadWith({ marksSince: LAST_DAY }));
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();
  });
});

describe("TimeSeriesChart marks-start note, (c): follows the zoom window", () => {
  it("a zoom that moves the first drawn day past the start hides it, and a reset shows it again", () => {
    const { container, getByTestId } = renderChart(payloadWith({ marksSince: START_INSIDE }));
    expect(container.querySelector(MARKER)).not.toBeNull();

    act(() => {
      fireEvent.click(getByTestId("zoom-past-start"));
    });
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();

    act(() => {
      fireEvent.click(getByTestId("reset"));
    });
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();
  });

  it("a zoom whose first drawn day is still before the start keeps it", () => {
    const { container, getByTestId } = renderChart(payloadWith({ marksSince: START_INSIDE }));
    act(() => {
      fireEvent.click(getByTestId("zoom-before-start"));
    });
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();
  });
});

describe("TimeSeriesChart marks-start note, (d): only while the cash-settlement series is drawn", () => {
  function mtmPayload(withBundle: boolean): FactsheetPayload {
    const base = payloadWith({ marksSince: START_INSIDE });
    if (!withBundle) return base;
    const bundle = deriveSeriesBundle(
      DATES.map((date, i) => ({ date, value: RETURNS[i] * 1.1 })),
      {
        periodsPerYear: 365,
        isArithmetic: false,
        markets: [],
        strategyName: "Synthetic",
        benchmarkPrices: { unavailable: true },
      },
    );
    return { ...base, seriesByBasis: { mark_to_market: bundle } } as unknown as FactsheetPayload;
  }

  it("basis mark_to_market with its bundle present hides the note: marks change only the cash-settlement series", () => {
    const { container } = renderChart(mtmPayload(true), cumulativeCfg, "mark_to_market");
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();
  });

  it("basis mark_to_market with the bundle absent falls back to cash, so the note shows", () => {
    const { container } = renderChart(mtmPayload(false), cumulativeCfg, "mark_to_market");
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();
  });

  it("basis smoothed_mtm with its bundle present hides the note, and with it absent shows it", () => {
    const withBundle = {
      ...mtmPayload(true),
    } as unknown as FactsheetPayload & { seriesByBasis: Record<string, unknown> };
    const smoothed = {
      ...withBundle,
      seriesByBasis: { smoothed_mtm: withBundle.seriesByBasis.mark_to_market },
    } as unknown as FactsheetPayload;
    const hidden = renderChart(smoothed, cumulativeCfg, "smoothed_mtm");
    expect(hidden.container.querySelector(MARKER)).toBeNull();
    hidden.unmount();
    const shown = renderChart(mtmPayload(false), cumulativeCfg, "smoothed_mtm");
    expect(shown.container.querySelector(MARKER)).not.toBeNull();
  });

  it("the default cash basis shows it", () => {
    const { container } = renderChart(mtmPayload(true), cumulativeCfg, "cash_settlement");
    expect(container.querySelector(MARKER)).not.toBeNull();
  });
});

describe("TimeSeriesChart marks-start note, (e): S3 appears on multi-account charts only", () => {
  const S3 = marksStartSentenceThree();

  it("a composite payload (dataQuality.composite) carries S3", () => {
    const { container } = renderChart(
      payloadWith({ marksSince: START_INSIDE, dataQuality: { composite: true } }),
    );
    const note = container.querySelector(NOTE)!;
    expect(note.textContent).toContain(S3);
    expect(note.textContent).toBe(marksStartCaption(START_FORMATTED, true));
  });

  it("an allocator-portfolio payload (strategyTypes) carries S3", () => {
    const { container } = renderChart(
      payloadWith({ marksSince: START_INSIDE, strategyTypes: ["allocator_portfolio"] }),
    );
    expect(container.querySelector(NOTE)!.textContent).toContain(S3);
  });

  it("a single-strategy payload does not carry S3", () => {
    const { container } = renderChart(
      payloadWith({ marksSince: START_INSIDE, strategyTypes: ["quant"], dataQuality: { composite: false } }),
    );
    const note = container.querySelector(NOTE)!;
    expect(note.textContent).not.toContain(S3);
    expect(note.textContent).toBe(marksStartCaption(START_FORMATTED, false));
  });
});

describe("TimeSeriesChart marks-start note: the flag is cumulative-only", () => {
  it("the cumVsBench config with the same payload draws no marker and no caption", () => {
    const { container } = renderChart(payloadWith({ marksSince: START_INSIDE }), cumVsBenchCfg);
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();
  });

  it("only key:cumulative sets the flag in CHART_CONFIGS", () => {
    const flagged = CHART_CONFIGS.filter((c) => (c as ChartConfig).marksStart === true).map((c) => c.key);
    expect(flagged).toEqual(["cumulative"]);
  });

  it("a payload without marksSince renders the same SVG node count as one with the start out of range", () => {
    const a = renderChart(payloadWith({}));
    const countA = a.container.querySelectorAll("*").length;
    a.unmount();
    const b = renderChart(payloadWith({ marksSince: "2025-01-01" }));
    expect(b.container.querySelectorAll("*").length).toBe(countA);
  });
});

describe("TimeSeriesChart marks-trailing note (SFH-2 N1): says so when the marks stopped updating", () => {
  const TRAILING = '[data-testid="marks-trailing-note"]';
  const TRAILING_DAY = "2026-02-20";
  const TRAILING_FORMATTED = "Feb 20, 2026";

  it("draws one note in the uppercase tracked mono voice, with the formatted day", () => {
    const { container } = renderChart(payloadWith({ marksSince: START_INSIDE, marksTrailingSince: TRAILING_DAY }));
    const note = container.querySelector(TRAILING)!;
    expect(note).not.toBeNull();
    expect(note.textContent).toBe("Marks paused from Feb 20, 2026");
    expect(note.textContent).toBe(marksTrailingNote(TRAILING_FORMATTED));
    for (const cls of ["font-mono", "uppercase", "tracking-wider", "text-text-secondary"]) {
      expect(note.className).toContain(cls);
    }
    // It sits after the start caption, as the figure's last child.
    expect(note.closest("figure")!.lastElementChild).toBe(note);
    expect(container.querySelector(NOTE)).not.toBeNull();
  });

  it("is not tied to the zoom window or to the start being drawn: a zoom past the start keeps it", () => {
    const { container, getByTestId } = renderChart(
      payloadWith({ marksSince: START_INSIDE, marksTrailingSince: TRAILING_DAY }),
    );
    act(() => {
      fireEvent.click(getByTestId("zoom-past-start"));
    });
    expect(container.querySelector(NOTE)).toBeNull();
    expect(container.querySelector(TRAILING)).not.toBeNull();
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["malformed text", "2026-02-30"],
    ["a malformed number", 20260220],
  ])("a %s day renders nothing new", (_label, marksTrailingSince) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderChart(payloadWith({ marksSince: START_INSIDE, marksTrailingSince }));
    expect(container.querySelector(TRAILING)).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/marks paused/i);
  });

  it("is hidden while a mark-to-market bundle is drawn, and only the cumulative config carries it", () => {
    const bundle = deriveSeriesBundle(
      DATES.map((date, i) => ({ date, value: RETURNS[i] * 1.1 })),
      { periodsPerYear: 365, isArithmetic: false, markets: [], strategyName: "Synthetic", benchmarkPrices: { unavailable: true } },
    );
    const p = payloadWith({ marksTrailingSince: TRAILING_DAY, seriesByBasis: { mark_to_market: bundle } });
    expect(renderChart(p, cumulativeCfg, "mark_to_market").container.querySelector(TRAILING)).toBeNull();
    cleanup();
    expect(renderChart(p, cumVsBenchCfg).container.querySelector(TRAILING)).toBeNull();
    cleanup();
    expect(renderChart(p, cumulativeCfg, "cash_settlement").container.querySelector(TRAILING)).not.toBeNull();
  });
});
