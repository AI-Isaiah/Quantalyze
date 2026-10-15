import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { parseReconstructedRanges } from "@/lib/factsheet/trade-fetch-provenance";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 167.1.2.2.2.1 (OKXHISTORY, plan 06) - the reconstructed-range line on
 * the factsheet header (D-06, D-07; SC-2, SC-4).
 *
 * WHY these assertions matter:
 *
 *   1. THE SENTENCE IS THE FOUNDER'S AND IS THE CONTRACT (D-06). Rebuilt days
 *      count in the headline metrics (D-07); the only thing telling a reader
 *      which days were rebuilt, and from what, is this one line. Every expected
 *      sentence below is a typed literal, with the display dates written out by
 *      hand, never produced by the component's own formatter, so a wording drift
 *      or a date-format drift fails here (a self-referential oracle could not).
 *
 *   2. ABSENCE IS ZERO NODES. No stored range, or a payload cached before the
 *      field existed (`undefined`), renders nothing and does not throw. A line
 *      printed for a strategy that rebuilt nothing would be a false public claim.
 *
 *   3. NO PER-ROW MARKER, NO ALARM (SC-2). The line is a muted-secondary
 *      caption: no negative or warning token, no glyph, no child element, wrapping
 *      text. It is not hidden from print or from any viewer.
 *
 * Harness mirrors FactsheetView.unrecovered-gap.test.tsx.
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
const SOURCE = "okx_bills_history_archive" as const;

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

function withRanges(
  reconstructedRanges: { from: string; to: string; source: typeof SOURCE }[],
): FactsheetPayload {
  return {
    ...basePayload,
    tradesFetchedAt: "2026-10-09T07:00:00Z",
    tradeFetchVenue: "okx",
    reconstructedRanges,
  };
}

function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

/** Every header paragraph that is a reconstructed-range statement (a named range or the count line). */
function rebuiltLines(container: HTMLElement): HTMLElement[] {
  const header = container.querySelector("header");
  return Array.from(header?.querySelectorAll("p") ?? []).filter((p) =>
    /rebuilt from OKX's quarterly account statement/.test(p.textContent ?? ""),
  ) as HTMLElement[];
}

const SENTENCE_JUL_AUG =
  "Jul 1, 2026 – Aug 1, 2026: rebuilt from OKX's quarterly account statement, not the live feed.";

describe("FactsheetView - ReconstructedRangeLines (D-06, D-07)", () => {
  it("one stored range: the founder's sentence, byte for byte, with the en dash", () => {
    const { container } = renderFactsheet(
      withRanges([{ from: "2026-07-01", to: "2026-08-01", source: SOURCE }]),
    );
    const lines = rebuiltLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(SENTENCE_JUL_AUG);
    expect(lines[0].textContent).toContain(" – ");
    expect(lines[0].textContent).not.toContain(" - ");
    expect(lines[0].className).toContain("mt-1");
    expect(lines[0].className).toContain("text-caption");
    expect(lines[0].className).toContain("text-text-secondary");
  });

  it("a one-day range: the same sentence with both dates equal, no invented variant", () => {
    const { container } = renderFactsheet(
      withRanges([{ from: "2026-09-03", to: "2026-09-03", source: SOURCE }]),
    );
    const lines = rebuiltLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(
      "Sep 3, 2026 – Sep 3, 2026: rebuilt from OKX's quarterly account statement, not the live feed.",
    );
  });

  it("no stored range: zero nodes, and no stray words about a rebuild anywhere", () => {
    const { container } = renderFactsheet(withRanges([]));
    expect(rebuiltLines(container)).toHaveLength(0);
    expect(container.textContent).not.toContain("rebuilt from OKX");
    expect(container.textContent).not.toContain("quarterly account statement");
  });

  it("a payload cached before the field existed (undefined) renders nothing instead of throwing", () => {
    const stale = { ...withRanges([]), reconstructedRanges: undefined } as unknown as FactsheetPayload;
    const { container } = renderFactsheet(stale);
    expect(rebuiltLines(container)).toHaveLength(0);
  });

  it("five ranges: the three newest in order, then `2 more ranges rebuilt ...`", () => {
    // Stored unsorted on purpose; the parser (the only reader of the record)
    // returns them newest `to` first, and the line renders that order.
    const provenance = {
      reconstructed_ranges: [
        { from: "2026-03-01", to: "2026-03-31", source: SOURCE },
        { from: "2026-01-05", to: "2026-01-09", source: SOURCE },
        { from: "2026-08-15", to: "2026-08-16", source: SOURCE },
        { from: "2026-05-07", to: "2026-07-08", source: SOURCE },
        { from: "2026-02-10", to: "2026-02-10", source: SOURCE },
      ],
    };
    const { container } = renderFactsheet(withRanges(parseReconstructedRanges(provenance)));
    expect(rebuiltLines(container).map((p) => p.textContent)).toEqual([
      "Aug 15, 2026 – Aug 16, 2026: rebuilt from OKX's quarterly account statement, not the live feed.",
      "May 7, 2026 – Jul 8, 2026: rebuilt from OKX's quarterly account statement, not the live feed.",
      "Mar 1, 2026 – Mar 31, 2026: rebuilt from OKX's quarterly account statement, not the live feed.",
      "2 more ranges rebuilt from OKX's quarterly account statement.",
    ]);
  });

  it("four ranges: the count line is singular, `1 more range ...`", () => {
    const { container } = renderFactsheet(
      withRanges([
        { from: "2026-08-15", to: "2026-08-16", source: SOURCE },
        { from: "2026-05-07", to: "2026-07-08", source: SOURCE },
        { from: "2026-03-01", to: "2026-03-31", source: SOURCE },
        { from: "2026-01-05", to: "2026-01-09", source: SOURCE },
      ]),
    );
    const texts = rebuiltLines(container).map((p) => p.textContent);
    expect(texts).toHaveLength(4);
    expect(texts[3]).toBe("1 more range rebuilt from OKX's quarterly account statement.");
  });

  it("a caption, not an alarm: no negative or warning token, no glyph, no child element, no print-hiding, wrapping text", () => {
    const { container } = renderFactsheet(
      withRanges([
        { from: "2026-07-01", to: "2026-08-01", source: SOURCE },
        { from: "2026-03-01", to: "2026-03-31", source: SOURCE },
      ]),
    );
    const lines = rebuiltLines(container);
    expect(lines).toHaveLength(2);
    for (const p of lines) {
      expect(p.tagName).toBe("P");
      expect(p.className).not.toContain("text-negative");
      expect(p.className).not.toContain("text-warning");
      expect(p.className).not.toContain("text-positive");
      expect(p.querySelector("*")).toBeNull();
      expect(p.textContent ?? "").not.toMatch(/[•●○◆▲▼⚠]/);
      expect(p.closest(".factsheet-v2-no-print")).toBeNull();
      for (const el of [p, p.parentElement as HTMLElement]) {
        expect(el.className).not.toMatch(
          /whitespace-nowrap|(^|\s)truncate(\s|$)|text-ellipsis|overflow-hidden|\bhidden\b|print:hidden|no-print/,
        );
      }
    }
  });

  it("SC-4: a partly rebuilt gap shows the remaining gap line AND the reconstructed line, each once, gap first", () => {
    const payload: FactsheetPayload = {
      ...withRanges([{ from: "2026-07-01", to: "2026-08-01", source: SOURCE }]),
      unrecoveredGaps: [{ from: "2026-05-24", to: "2026-06-30" }],
    };
    const { container } = renderFactsheet(payload);
    const header = container.querySelector("header");
    const gaps = Array.from(header?.querySelectorAll("p") ?? []).filter((p) =>
      /^No trade data /.test(p.textContent ?? ""),
    );
    const rebuilt = rebuiltLines(container);
    // 2026-05-24..2026-06-30: 8 days of May (24..31) + 30 of June = 38, worked by hand.
    expect(gaps.map((p) => p.textContent)).toEqual([
      "No trade data May 24, 2026 – Jun 30, 2026 (38 days). These days are not recovered; they are left out of the record, not counted as zero.",
    ]);
    expect(rebuilt.map((p) => p.textContent)).toEqual([SENTENCE_JUL_AUG]);
    expect(gaps[0].nextElementSibling).toBe(rebuilt[0]);
  });

  // Review round 1, F5 / IN-01: a malformed `reconstructed_ranges` record is
  // absence of KNOWLEDGE, not absence of a rebuild. The RPC already removed the
  // rebuilt days from `unrecovered_gaps`, so a silent render would present them
  // as live. The header says the record is unavailable (muted, never red or
  // amber: the page admits it does not know, as TradeFetchUnavailableLine does).
  describe("malformed record (F5 / IN-01)", () => {
    const UNAVAILABLE =
      "Record of rebuilt days unavailable. Some days may come from a quarterly statement, not the live feed.";

    function unavailableLines(container: HTMLElement): HTMLElement[] {
      const header = container.querySelector("header");
      return Array.from(header?.querySelectorAll("p") ?? []).filter((p) =>
        /^Record of rebuilt days unavailable/.test(p.textContent ?? ""),
      ) as HTMLElement[];
    }

    it("renders the unavailable sentence, muted-secondary, once, when the payload flags it", () => {
      const { container } = renderFactsheet({
        ...withRanges([]),
        reconstructedRangesUnavailable: true,
      });
      const lines = unavailableLines(container);
      expect(lines).toHaveLength(1);
      expect(lines[0].textContent).toBe(UNAVAILABLE);
      expect(lines[0].className).toContain("mt-1");
      expect(lines[0].className).toContain("text-caption");
      expect(lines[0].className).toContain("text-text-secondary");
      expect(lines[0].className).not.toMatch(/text-negative|text-warning|text-amber/);
      // The D-06 sentence is not printed for a record we could not read.
      expect(rebuiltLines(container)).toHaveLength(0);
    });

    it("a healthy payload (flag false or absent) prints no unavailable line", () => {
      for (const flag of [false, undefined]) {
        const { container, unmount } = renderFactsheet({
          ...withRanges([]),
          reconstructedRangesUnavailable: flag,
        });
        expect(unavailableLines(container)).toHaveLength(0);
        unmount();
      }
    });

    it("the D-06 sentence stays byte-identical beside a flagged payload that also carries ranges", () => {
      const { container } = renderFactsheet({
        ...withRanges([{ from: "2026-07-01", to: "2026-08-01", source: SOURCE }]),
        reconstructedRangesUnavailable: false,
      });
      expect(rebuiltLines(container).map((p) => p.textContent)).toEqual([SENTENCE_JUL_AUG]);
    });
  });
});
