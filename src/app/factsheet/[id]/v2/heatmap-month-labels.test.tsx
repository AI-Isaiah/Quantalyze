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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
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
