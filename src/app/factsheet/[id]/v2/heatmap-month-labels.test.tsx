/** @vitest-environment jsdom */
/**
 * Phase 170.1.3 NARROWCHARTS (D-02, D-03c): the daily calendar's month labels are drawn whole.
 *
 * Why: the SVG overlay drew each month name at baseline y = 10 inside a 14-unit label band.
 * Mobile bumps the font to 13, and a 13 px mono text reaches about 13 above its baseline, so
 * its box started 3 px above the overlay (the composer's and Overview's phone readings showed
 * all 13 labels cut at the top). The baseline now follows the font (`fitBaselineY`) and the
 * band grows with it, so the first cell row never moves under a descender; desktop (font 9,
 * baseline 10, band 14) is unchanged. Every expected number is typed by hand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { useBreakpoint } from "@/hooks/useBreakpoint";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { DailyReturnsHeatmap } from "./HeatmapPanels";

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  });
  vi.mocked(useBreakpoint).mockReturnValue("desktop");
});
afterEach(() => {
  vi.restoreAllMocks();
});

function payload(): FactsheetPayload {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    value: Math.sin(i / 5) * 0.008,
  }));
  const p = buildFactsheetPayload(
    {
      id: "heatmap-month-labels",
      name: "Heatmap Month Labels",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-10-21T00:00:00Z",
      trustTier: null,
      assetClass: "crypto",
      ingestSource: "api",
    },
    rows,
  );
  if (!p) throw new Error("fixture must build");
  return p;
}

function mount() {
  return render(
    <FactsheetProvider payload={payload()} persist={false}>
      <DailyReturnsHeatmap />
    </FactsheetProvider>,
  );
}

const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;

function monthTexts(container: HTMLElement): SVGTextElement[] {
  return (Array.from(container.querySelectorAll("svg text")) as SVGTextElement[]).filter((t) =>
    MONTH_RE.test(t.textContent ?? ""),
  );
}

describe("daily calendar month labels stay inside the overlay svg (D-03c)", () => {
  it("mobile: font 13 sits on baseline 14 and the label band is 18, so the box starts at 0", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const { container } = mount();
    const months = monthTexts(container);
    expect(months.length).toBeGreaterThanOrEqual(12);
    for (const t of months) {
      expect(t.getAttribute("font-size")).toBe("13");
      // ceil(13 * 1.05) = 14: the baseline is lowered from 10, the text itself is unchanged.
      expect(t.getAttribute("y")).toBe("14");
    }
    // Band 18 + 7 rows of 14 = 116 (desktop is 14 + 98 = 112).
    const svg = months[0].closest("svg")!;
    expect(svg.getAttribute("viewBox")?.split(" ")[3]).toBe("116");
    // Weekday labels follow the band: row 2 ("W") baseline = 18 + 2 * 14 + 8 = 54.
    const wed = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === "W");
    expect(wed?.getAttribute("y")).toBe("54");
  });

  it("desktop: font 9 stays on baseline 10 in a 14 band (nothing was cut, nothing moves)", () => {
    const { container } = mount();
    const months = monthTexts(container);
    expect(months.length).toBeGreaterThanOrEqual(12);
    for (const t of months) {
      expect(t.getAttribute("font-size")).toBe("9");
      expect(t.getAttribute("y")).toBe("10");
    }
    const svg = months[0].closest("svg")!;
    expect(svg.getAttribute("viewBox")?.split(" ")[3]).toBe("112");
    const wed = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === "W");
    expect(wed?.getAttribute("y")).toBe("50");
  });
});

describe("each year's calendar draws only that year's days (D-05, founder 2026-10-26)", () => {
  // Phase 170.1.3 D-05. A non-leap year whose Jan 1 is a Sunday (2023) fills a 54th week column
  // (x = 14 + 53 * 14 = 756). That column's first day is day-of-year 366, which in a non-leap year
  // is 1 January of the NEXT year, so the month loop used to draw a second "Jan" there (and the
  // label ran past the week grid, which plan 06 answered by widening the calendar). The loop now
  // stops at the year's own last day: one "Jan", no label past the grid, and the viewBox stays at
  // the grid width 14 + 54 * 14 = 770 on both arms, so every year row keeps one scale.
  function mountYear2023() {
    const rows = Array.from({ length: 400 }, (_, i) => ({
      date: new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      value: Math.sin(i / 5) * 0.008,
    }));
    const p = buildFactsheetPayload(
      {
        id: "heatmap-month-labels-2023",
        name: "Heatmap Month Labels 2023",
        types: ["test"],
        markets: ["crypto"],
        computedAt: "2026-10-21T00:00:00Z",
        trustTier: null,
        assetClass: "crypto",
        ingestSource: "api",
      },
      rows,
    );
    if (!p) throw new Error("fixture must build");
    return render(
      <FactsheetProvider payload={p} persist={false}>
        <DailyReturnsHeatmap />
      </FactsheetProvider>,
    );
  }
  const calendar = (container: HTMLElement, year: string) => {
    const wrap = container.querySelector(`[aria-label="Daily-return calendar for ${year}"]`);
    if (!wrap) throw new Error(`no calendar for ${year}`);
    return wrap;
  };

  it("both arms: the 2023 calendar has exactly one Jan at x = 14 and keeps the grid width 770", () => {
    for (const bp of ["mobile", "desktop"] as const) {
      vi.mocked(useBreakpoint).mockReturnValue(bp);
      const { container, unmount } = mountYear2023();
      const wrap = calendar(container, "2023") as HTMLElement;
      const months = monthTexts(wrap);
      expect(months.map((t) => t.textContent), bp).toEqual([
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ]);
      expect(months[0].getAttribute("x"), bp).toBe("14");
      expect(Number(wrap.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2]), bp).toBe(770);
      unmount();
    }
  });

  it("both arms: calendars whose labels fit keep the grid width 770 (the standard book is unchanged)", () => {
    for (const bp of ["mobile", "desktop"] as const) {
      vi.mocked(useBreakpoint).mockReturnValue(bp);
      const { container, unmount } = mount();
      for (const year of ["2025", "2026"]) {
        const w = Number(calendar(container, year).querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2]);
        expect(w, `${bp} ${year}`).toBe(770);
      }
      unmount();
    }
  });

  // Hover pins. jsdom has no layout, so the wrapper is given a 770 x 112 box (the viewBox), which
  // makes a client coordinate equal its viewBox coordinate (scale 1). Week 53 starts at x 756 and
  // weekday 0 (Monday) at y 14 + 0 * 14 = 14.
  function mountYearWithCells(year: string, firstWeekOffset: number, filled: Array<[number, number]>) {
    const cells = Array.from({ length: 54 }, () => new Array<number | null>(7).fill(null));
    for (const [wk, d] of filled) cells[wk][d] = 0.012;
    const base = payload();
    const p = { ...base, dailyHeatmap: [{ year, firstWeekOffset, cells }] } as unknown as FactsheetPayload;
    return render(
      <FactsheetProvider payload={p} persist={false}>
        <DailyReturnsHeatmap />
      </FactsheetProvider>,
    );
  }
  async function hoverCell(container: HTMLElement, year: string, wk: number, d: number) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 770, bottom: 112, width: 770, height: 112, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const wrap = calendar(container, year);
    await act(async () => {
      fireEvent.pointerMove(wrap, { pointerId: 1, pointerType: "mouse", clientX: 15 + wk * 14, clientY: 15 + d * 14 });
    });
    return container.querySelector('[role="status"]');
  }

  it("hovering the 2023 calendar's last column yields no 2024 date (day 366 is not a 2023 day)", async () => {
    // Offset 6 (Jan 1 2023 is a Sunday): week 53, Monday = day-of-year 53 * 7 + 0 - 6 + 1 = 366.
    const { container } = mountYearWithCells("2023", 6, [[53, 0], [52, 6]]);
    expect(await hoverCell(container, "2023", 53, 0)).toBeNull();
    // Control: week 52, Sunday is Dec 31 2023 (day 365) and still reveals.
    const tip = await hoverCell(container, "2023", 52, 6);
    expect(tip?.textContent).toContain("2023-12-31");
  });

  it("a leap year starting on a Sunday keeps its day 366 (Dec 31) in the last column", async () => {
    // 2012: Jan 1 is a Sunday, so week 53 Monday = day-of-year 366 = Dec 31 2012, a real 2012 day.
    const { container } = mountYearWithCells("2012", 6, [[53, 0]]);
    const tip = await hoverCell(container, "2012", 53, 0);
    expect(tip?.textContent).toContain("2012-12-31");
  });

  // Canvas pins. jsdom's getContext("2d") is null, so the draw effect used to return early and no
  // pin observed a pixel. This stub records every fillRect / strokeRect (x, y) the effect issues.
  // 2023: offset 6, so week 0 Mon..Sat (weekday 0..5) are 26..31 Dec 2022 and week 53 is 1..7 Jan
  // 2024. Cell x = 14 + wk * 14, cell y = 14 + weekday * 14 (label band 14 on desktop).
  function recordCanvasRects() {
    const fills: Array<[number, number]> = [];
    const strokes: Array<[number, number]> = [];
    const ctx = {
      setTransform: () => undefined,
      scale: () => undefined,
      clearRect: () => undefined,
      fillRect: (x: number, y: number) => void fills.push([x, y]),
      strokeRect: (x: number, y: number) => void strokes.push([x, y]),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    return { fills, strokes };
  }

  it("draws no box for another year's slots, and keeps the box for an in-year day with no data (D-05)", () => {
    const { fills, strokes } = recordCanvasRects();
    // One real value (week 10, Monday); every other slot is null.
    mountYearWithCells("2023", 6, [[10, 0]]);
    for (const rects of [fills, strokes]) {
      const hits = (x: number, y: number) =>
        rects.some(([rx, ry]) => Math.abs(rx - x) < 1 && Math.abs(ry - y) < 1);
      // The 2023 last column (x 756) is 1..7 Jan 2024: nothing at any weekday.
      for (let d = 0; d < 7; d++) expect(hits(756, 14 + d * 14), `x 756 weekday ${d}`).toBe(false);
      // Week 0 weekday 0..5 are 26..31 Dec 2022: nothing at x 14, y 14..84.
      for (let d = 0; d < 6; d++) expect(hits(14, 14 + d * 14), `week 0 weekday ${d}`).toBe(false);
      // Week 0 Sunday (y 98) is 1 Jan 2023, an in-year day with no data: it keeps its missing box.
      expect(hits(14, 98), "1 Jan 2023").toBe(true);
      // Week 52 Sunday (x 742, y 98) is 31 Dec 2023, in-year with no data: box kept.
      expect(hits(742, 98), "31 Dec 2023").toBe(true);
    }
    // The real value still paints (fill only).
    expect(fills.some(([x, y]) => x === 14 + 10 * 14 && y === 14)).toBe(true);
  });
});
