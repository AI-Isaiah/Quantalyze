import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { deriveSegmentMarkers, inclusiveDayCount } from "@/lib/factsheet/build-payload";
import { parseUnrecoveredGaps } from "@/lib/factsheet/trade-fetch-provenance";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 167.1.2.2.2 (TRADESYNC, plan 11) - the named unrecovered gap on the
 * factsheet header (D-02, F1, UI-SPEC "Named unrecovered gap" as amended by F1).
 *
 * WHY these assertions matter:
 *
 *   1. THE LINE IS A PUBLIC STATEMENT ABOUT MISSING DATA, SO IT MAY SAY ONLY
 *      WHAT IS TRUE AT SHIP TIME (F1). The UI-SPEC's draft said "the exchange no
 *      longer serves these days". That is false for OKX: its quarterly archive
 *      serves them, and Phase 167.1.2.2.2.1 OKXHISTORY recovers them. The binding
 *      copy says only that the days are not recovered, left out of the record and
 *      not counted as zero. The second clause is true only because plan 07's
 *      `TestNamedGapIsNeverZeroFilled` passes; the negative assertions below pin
 *      that the false phrase never returns.
 *
 *   2. EVERY EXPECTED SENTENCE IS A TYPED LITERAL, never produced by the
 *      component's own formatter, so a copy or date-format drift fails here (a
 *      self-referential oracle could not). The 63 in the first case is worked by
 *      hand: 2026-05-07..2026-05-31 is 25 days, June is 30, 2026-07-01..07-08 is
 *      8, and 25 + 30 + 8 = 63, both ends inclusive.
 *
 *   3. THE DAY COUNT IS THE CHART SEAM'S. `{days}` and the seam's `{days}d — no
 *      data` come from one `inclusiveDayCount`; the agreement cases build the
 *      seam through the real `deriveSegmentMarkers` and compare, on a span that
 *      crosses a month end, so the two can never disagree for one span.
 *
 *   4. ABSENCE IS NOT AN ALARM. A gap is missing data, not a failure
 *      (DESIGN.md: red is never for absence), so the line carries no negative or
 *      warning token and no dot or glyph, and it is `text-text-secondary`.
 *
 * Harness mirrors FactsheetView.trade-fetch-line.test.tsx.
 */

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

const NOW = "2026-10-09T12:00:00Z";

beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Fixtures (all typed literals)
// ---------------------------------------------------------------------------

const SERIES_END = "2026-10-08";

function makeReturnsSeriesEndingOn(n: number, endIso: string, drift = 0.0015): DailyPoint[] {
  const end = new Date(`${endIso}T00:00:00Z`);
  const pts: DailyPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin((n - 1 - i) * 0.27) * 0.005,
    });
  }
  return pts;
}

const basePayload: FactsheetPayload = {
  ...buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeriesEndingOn(300, SERIES_END),
    benchmark: null,
  }),
  computedAt: "2026-10-09T03:00:00Z",
};

function withGaps(
  unrecoveredGaps: { from: string; to: string }[],
  tradesFetchedAt: string | null = "2026-10-09T07:00:00Z",
  tradeFetchVenue: string | null = "okx",
): FactsheetPayload {
  return { ...basePayload, tradesFetchedAt, tradeFetchVenue, unrecoveredGaps };
}

function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

/** Every header paragraph that is a gap statement (a named gap or the overflow line). */
function gapLines(container: HTMLElement): HTMLElement[] {
  const header = container.querySelector("header");
  return Array.from(header?.querySelectorAll("p") ?? []).filter((p) =>
    /^No trade data |more gaps? without trade data\.$/.test(p.textContent ?? ""),
  ) as HTMLElement[];
}

function tradeFetchLine(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector("header");
  return (
    (Array.from(header?.querySelectorAll("p") ?? []).find((p) =>
      /last trades fetched|trade fetch recorded/i.test(p.textContent ?? ""),
    ) as HTMLElement | undefined) ?? null
  );
}

const GAP_63 =
  "No trade data May 7, 2026 – Jul 8, 2026 (63 days). These days are not recovered; they are left out of the record, not counted as zero.";
const GAP_1 =
  "No trade data Sep 3, 2026 (1 day). This day is not recovered; it is left out of the record, not counted as zero.";

describe("FactsheetView - UnrecoveredGapLines (D-02, F1)", () => {
  it("one multi-day gap: the binding F1 sentence, an en dash with a space either side, 63 inclusive days", () => {
    const { container } = renderFactsheet(withGaps([{ from: "2026-05-07", to: "2026-07-08" }]));
    const lines = gapLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(GAP_63);
    expect(lines[0].className).toContain("mt-1");
    expect(lines[0].className).toContain("text-caption");
    expect(lines[0].className).toContain("text-text-secondary");
  });

  it("a one-day gap: the singular sentence, `(1 day)`, no range, `This day`", () => {
    const { container } = renderFactsheet(withGaps([{ from: "2026-09-03", to: "2026-09-03" }]));
    const lines = gapLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(GAP_1);
  });

  it("five gaps: the three newest in order, then `2 more gaps without trade data.`", () => {
    // Stored unsorted on purpose; the parser (the only reader of the record)
    // returns them newest `to` first, and the line renders that order.
    const provenance = {
      unrecovered_gaps: [
        { from: "2026-03-01", to: "2026-03-31" },
        { from: "2026-01-05", to: "2026-01-09" },
        { from: "2026-08-15", to: "2026-08-16" },
        { from: "2026-05-07", to: "2026-07-08" },
        { from: "2026-02-10", to: "2026-02-10" },
      ],
    };
    const { container } = renderFactsheet(withGaps(parseUnrecoveredGaps(provenance)));
    const texts = gapLines(container).map((p) => p.textContent);
    expect(texts).toEqual([
      "No trade data Aug 15, 2026 – Aug 16, 2026 (2 days). These days are not recovered; they are left out of the record, not counted as zero.",
      GAP_63,
      "No trade data Mar 1, 2026 – Mar 31, 2026 (31 days). These days are not recovered; they are left out of the record, not counted as zero.",
      "2 more gaps without trade data.",
    ]);
  });

  it("exactly three gaps: all three named, no overflow line", () => {
    const gaps = [
      { from: "2026-08-15", to: "2026-08-16" },
      { from: "2026-05-07", to: "2026-07-08" },
      { from: "2026-03-01", to: "2026-03-31" },
    ];
    const { container } = renderFactsheet(withGaps(gaps));
    const texts = gapLines(container).map((p) => p.textContent ?? "");
    expect(texts).toHaveLength(3);
    expect(texts.some((t) => /more gaps?/.test(t))).toBe(false);
  });

  it("four gaps: the overflow line is singular, `1 more gap without trade data.`", () => {
    const gaps = [
      { from: "2026-08-15", to: "2026-08-16" },
      { from: "2026-05-07", to: "2026-07-08" },
      { from: "2026-03-01", to: "2026-03-31" },
      { from: "2026-01-05", to: "2026-01-09" },
    ];
    const { container } = renderFactsheet(withGaps(gaps));
    const texts = gapLines(container).map((p) => p.textContent);
    expect(texts).toHaveLength(4);
    expect(texts[3]).toBe("1 more gap without trade data.");
  });

  it("zero gaps: zero gap nodes, and no stray words about gaps anywhere", () => {
    const { container } = renderFactsheet(withGaps([]));
    expect(gapLines(container)).toHaveLength(0);
    expect(container.textContent).not.toContain("No trade data");
    expect(container.textContent).not.toContain("not counted as zero");
  });

  it("a payload cached before the field existed (unrecoveredGaps undefined) renders no gap line instead of throwing", () => {
    const stale = { ...withGaps([]), unrecoveredGaps: undefined } as unknown as FactsheetPayload;
    const { container } = renderFactsheet(stale);
    expect(gapLines(container)).toHaveLength(0);
  });

  it("F1: no gap line says the exchange no longer serves the days, in any state", () => {
    const { container } = renderFactsheet(
      withGaps([
        { from: "2026-05-07", to: "2026-07-08" },
        { from: "2026-09-03", to: "2026-09-03" },
      ]),
    );
    const text = gapLines(container)
      .map((p) => p.textContent)
      .join(" | ");
    expect(text).not.toMatch(/no longer serves?/i);
    expect(text).not.toMatch(/exchange/i);
    expect(text).not.toMatch(/metrics use/i);
    // And the document as a whole never makes the claim either.
    expect(container.textContent).not.toMatch(/no longer serves?/i);
  });

  it("absence, not alarm: no negative or warning token, no dot, no glyph, no child element", () => {
    const { container } = renderFactsheet(
      withGaps([
        { from: "2026-05-07", to: "2026-07-08" },
        { from: "2026-09-03", to: "2026-09-03" },
      ]),
    );
    const lines = gapLines(container);
    expect(lines).toHaveLength(2);
    for (const p of lines) {
      expect(p.className).not.toContain("text-negative");
      expect(p.className).not.toContain("text-warning");
      expect(p.className).not.toContain("text-positive");
      expect(p.querySelector("*")).toBeNull();
      expect(p.getAttribute("role")).toBeNull();
      expect(p.getAttribute("aria-live")).toBeNull();
      expect(p.textContent ?? "").not.toMatch(/[•●○◆▲▼⚠]/);
    }
  });

  it("static `p` with no print-hiding: neither the line nor an ancestor carries the no-print class", () => {
    const { container } = renderFactsheet(withGaps([{ from: "2026-05-07", to: "2026-07-08" }]));
    const line = gapLines(container)[0];
    expect(line.tagName).toBe("P");
    expect(line.closest(".factsheet-v2-no-print")).toBeNull();
    expect(line.className).not.toMatch(/\bhidden\b|print:hidden|no-print/);
  });

  it("placement: directly after the trade-fetch line, newest first, in the same wrapper", () => {
    const { container } = renderFactsheet(
      withGaps([
        { from: "2026-08-15", to: "2026-08-16" },
        { from: "2026-05-07", to: "2026-07-08" },
      ]),
    );
    const fetchLine = tradeFetchLine(container);
    const lines = gapLines(container);
    expect(fetchLine, "trade-fetch line did not render").not.toBeNull();
    expect(lines).toHaveLength(2);
    expect(fetchLine!.nextElementSibling).toBe(lines[0]);
    expect(lines[0].nextElementSibling).toBe(lines[1]);
    expect(lines[0].parentElement).toBe(fetchLine!.parentElement);
    expect(lines[0].textContent).toContain("Aug 15, 2026");
    expect(lines[1].textContent).toContain("May 7, 2026");
  });

  it("a gap is server truth independent of the trade-fetch line: it renders when that line makes no claim", () => {
    // A CSV or composite payload has no trade-fetch claim (zero nodes), but a
    // stored gap record is still a statement about the record and still shows.
    const { container } = renderFactsheet(
      withGaps([{ from: "2026-05-07", to: "2026-07-08" }], null, null),
    );
    expect(tradeFetchLine(container)).toBeNull();
    const lines = gapLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(GAP_63);
  });

  it("the day count is the chart seam's: one span through the real seam derivation reads the same N", () => {
    // 2026-02-27..2026-03-02 crosses a month end: 27, 28 Feb + 1, 2 Mar = 4.
    const spans = [
      { start: "2026-05-07", end: "2026-07-08", days: 63 },
      { start: "2026-02-27", end: "2026-03-02", days: 4 },
    ];
    for (const span of spans) {
      const seam = deriveSegmentMarkers({ gap_spans: [{ start: span.start, end: span.end }] })
        .missingSegments[0];
      expect(seam.days, "seam disagrees with the hand-worked count").toBe(span.days);
      expect(inclusiveDayCount(span.start, span.end)).toBe(span.days);

      const { container, unmount } = renderFactsheet(
        withGaps([{ from: span.start, to: span.end }]),
      );
      const line = gapLines(container)[0];
      expect(line.textContent).toContain(`(${seam.days} days)`);
      unmount();
    }
  });

  it("long text wraps: the gap paragraph and its wrapper carry no whitespace-nowrap or truncate", () => {
    const { container } = renderFactsheet(
      withGaps([
        { from: "2026-08-15", to: "2026-08-16" },
        { from: "2026-05-07", to: "2026-07-08" },
        { from: "2026-03-01", to: "2026-03-31" },
        { from: "2026-02-10", to: "2026-02-10" },
        { from: "2026-01-05", to: "2026-01-09" },
      ]),
    );
    const lines = gapLines(container);
    expect(lines.length).toBeGreaterThan(0);
    for (const p of lines) {
      for (const el of [p, p.parentElement as HTMLElement]) {
        expect(el.className).not.toMatch(/whitespace-nowrap|(^|\s)truncate(\s|$)|text-ellipsis|overflow-hidden/);
      }
    }
  });
});
