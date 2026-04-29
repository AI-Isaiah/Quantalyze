import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { DailyHeatmap, SVG_THRESHOLD_CELLS } from "./DailyHeatmap";

/**
 * Phase 14b / KPI-07 — DailyHeatmap dual SVG/Canvas renderer tests.
 *
 * 14 acceptance criteria from 14b-01-PLAN Task 2:
 *  1. SVG branch when data.length === 30 (≤365 cells)
 *  2. Canvas branch when data.length === 1825 (5y, > 365 cells); offscreen <table> mirror present
 *  3. SVG cell with value > 0.10 → fill="#16A34A" (saturated positive)
 *  4. SVG cell with value < -0.10 → fill="#DC2626" (saturated negative)
 *  5. SVG cell with value === 0 → fill="#FFFFFF" + non-empty <title>
 *  6. SVG cell stroke="#E2E8F0" (CHART_BORDER) gridline
 *  7. Canvas branch — getContext('2d').fillRect called exactly data.length times
 *  8. Canvas branch — role="presentation" on <canvas>; <table> mirror with year rows
 *  9. Canvas branch — performance.mark('panel-4-mount-start') and 'panel-4-mount-end'
 * 10. 9-step diverging color scale renders correct hex per value
 * 11. SVG axis labels — Y-axis CHART_FONT_MONO; X-axis no monospace
 * 12. Empty data array — renders empty container without crashing
 * 13. Canvas geometry no-overflow (Grok B-02): max (x+w) ≤ 730
 * 14. Canvas geometry — exactly 5 unique Y-row positions for 5y fixture
 */

interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  fillStyle: string;
  globalAlpha: number;
}

let fillRectCalls: FillRectCall[] = [];
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

function installCanvasMock() {
  fillRectCalls = [];
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  const fakeCtx = {
    fillStyle: "" as string,
    globalAlpha: 1 as number,
    fillRect(x: number, y: number, w: number, h: number) {
      fillRectCalls.push({
        x,
        y,
        w,
        h,
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
      });
    },
    // SR-2 (v0.17.1): the per-paint save/restore pair isolates globalAlpha
    // mutations on the canvas context. Mocked as no-ops; integration paths
    // exercise the real CanvasRenderingContext2D in the browser/Playwright.
    save() {},
    restore() {},
    // clearRect mock — SR-2 follow-up (review fix): paint loop clears stale
    // pixels before redrawing so subsetted data doesn't leave ghost cells.
    clearRect(_x: number, _y: number, _w: number, _h: number) {},
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeCtx) as never;
}

function restoreCanvasMock() {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  fillRectCalls = [];
}

/**
 * Build a deterministic 5-year fixture spanning 2020-01-01..2024-12-31.
 * Each cell carries a small returning value (alternating sign) so any code
 * path through the color scale produces a non-empty fillRect call.
 */
function buildFiveYearFixture(): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let y = 2020; y <= 2024; y++) {
    const days = monthDays.slice();
    if (isLeap(y)) days[1] = 29;
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= days[m]; d++) {
        const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const v = ((d % 5) - 2) / 100; // [-0.02, 0.02]
        out.push({ date: dateStr, value: v });
      }
    }
  }
  return out;
}

beforeEach(() => {
  installCanvasMock();
});

afterEach(() => {
  restoreCanvasMock();
  vi.restoreAllMocks();
});

describe("DailyHeatmap — Phase 14b dual renderer", () => {
  it("exports SVG_THRESHOLD_CELLS = 365", () => {
    expect(SVG_THRESHOLD_CELLS).toBe(365);
  });

  it("Test 1: data.length === 30 → SVG branch (no canvas)", () => {
    const data = Array.from({ length: 30 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      value: 0.01,
    }));
    const { container } = render(<DailyHeatmap data={data} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("Test 2: data.length === 1825 → Canvas branch with <table> mirror", () => {
    const data = buildFiveYearFixture();
    // 2020 + 2024 are both leap years (+2) plus 5 × 365 = 1827 base days.
    // Trim to exactly 1825 days for the plan's documented 5y fixture size.
    expect(data.length).toBe(1827);
    const trimmed = data.slice(0, 1825);
    const { container } = render(<DailyHeatmap data={trimmed} />);
    expect(container.querySelector("canvas")).not.toBeNull();
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const cells = table?.querySelectorAll("td") ?? [];
    expect(cells.length).toBe(1825);
  });

  it("Test 3: SVG cell with value > 0.10 has fill='#16A34A'", () => {
    const data = [{ date: "2024-01-01", value: 0.15 }];
    const { container } = render(<DailyHeatmap data={data} />);
    const rect = container.querySelector("svg rect[data-cell]");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("fill")).toBe("#16A34A");
  });

  it("Test 4: SVG cell with value < -0.10 has fill='#DC2626'", () => {
    const data = [{ date: "2024-01-01", value: -0.15 }];
    const { container } = render(<DailyHeatmap data={data} />);
    const rect = container.querySelector("svg rect[data-cell]");
    expect(rect?.getAttribute("fill")).toBe("#DC2626");
  });

  it("Test 5: SVG cell with value === 0 has fill='#FFFFFF' and non-empty <title>", () => {
    const data = [{ date: "2024-03-15", value: 0 }];
    const { container } = render(<DailyHeatmap data={data} />);
    const rect = container.querySelector("svg rect[data-cell]");
    expect(rect?.getAttribute("fill")).toBe("#FFFFFF");
    const title = container.querySelector("svg title");
    expect(title?.textContent).toBe("2024-03-15: 0.00%");
  });

  it("Test 6: every SVG cell carries stroke='#E2E8F0' gridline", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      value: 0.01,
    }));
    const { container } = render(<DailyHeatmap data={data} />);
    const rects = container.querySelectorAll("svg rect[data-cell]");
    expect(rects.length).toBe(12);
    for (const r of rects) {
      expect(r.getAttribute("stroke")).toBe("#E2E8F0");
    }
  });

  it("Test 7: Canvas branch — fillRect called exactly data.length times", () => {
    const trimmed = buildFiveYearFixture().slice(0, 1825);
    render(<DailyHeatmap data={trimmed} />);
    expect(fillRectCalls.length).toBe(1825);
  });

  it("Test 8: Canvas role='presentation' + <table> mirror with year rows", () => {
    const trimmed = buildFiveYearFixture().slice(0, 1825);
    const { container } = render(<DailyHeatmap data={trimmed} />);
    const canvas = container.querySelector("canvas");
    expect(canvas?.getAttribute("role")).toBe("presentation");
    const rows = container.querySelectorAll("table tbody tr");
    // 5 unique years across the fixture (2020..2024)
    expect(rows.length).toBe(5);
  });

  it("Test 9: Canvas branch emits performance.mark for panel-4 paint window", () => {
    const markSpy = vi.spyOn(performance, "mark");
    const trimmed = buildFiveYearFixture().slice(0, 1825);
    render(<DailyHeatmap data={trimmed} />);
    const startCall = markSpy.mock.calls.find((c) => c[0] === "panel-4-mount-start");
    const endCall = markSpy.mock.calls.find((c) => c[0] === "panel-4-mount-end");
    expect(startCall).toBeDefined();
    expect(endCall).toBeDefined();
  });

  it("Test 10: 9-step diverging color scale across [+0.15, +0.07, +0.03, +0.01, 0, -0.01, -0.03, -0.07, -0.15]", () => {
    const cases: Array<{ value: number; fill: string; opacity: number }> = [
      { value: 0.15, fill: "#16A34A", opacity: 1 },
      { value: 0.07, fill: "#16A34A", opacity: 0.7 },
      { value: 0.03, fill: "#16A34A", opacity: 0.4 },
      { value: 0.01, fill: "#16A34A", opacity: 0.15 },
      { value: 0, fill: "#FFFFFF", opacity: 1 },
      { value: -0.01, fill: "#DC2626", opacity: 0.15 },
      { value: -0.03, fill: "#DC2626", opacity: 0.4 },
      { value: -0.07, fill: "#DC2626", opacity: 0.7 },
      { value: -0.15, fill: "#DC2626", opacity: 1 },
    ];
    for (const c of cases) {
      const { container, unmount } = render(
        <DailyHeatmap data={[{ date: "2024-01-01", value: c.value }]} />,
      );
      const rect = container.querySelector("svg rect[data-cell]");
      expect(rect?.getAttribute("fill")).toBe(c.fill);
      const opacityAttr = rect?.getAttribute("fill-opacity") ?? "1";
      expect(parseFloat(opacityAttr)).toBeCloseTo(c.opacity, 5);
      unmount();
    }
  });

  it("Test 11: SVG Y-axis label uses CHART_FONT_MONO; X-axis label has no fontFamily attr", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({
      date: `2024-${String(i + 1).padStart(2, "0")}-15`,
      value: 0.01,
    }));
    const { container } = render(<DailyHeatmap data={data} />);
    const yLabel = container.querySelector('svg text[data-axis="year"]');
    const xLabel = container.querySelector('svg text[data-axis="month"]');
    expect(yLabel).not.toBeNull();
    expect(xLabel).not.toBeNull();
    const yFontFamily = yLabel?.getAttribute("font-family") ?? "";
    expect(yFontFamily).toContain("var(--font-mono)");
    expect(xLabel?.getAttribute("font-family")).toBeNull();
  });

  it("Test 12: empty data renders empty container without crashing", () => {
    const { container } = render(<DailyHeatmap data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.firstChild).not.toBeNull(); // has wrapper div
  });

  it("Test 13 (Grok B-02): Canvas geometry — max(x + cellWidth) ≤ 730 for 5y fixture", () => {
    const trimmed = buildFiveYearFixture().slice(0, 1825);
    render(<DailyHeatmap data={trimmed} />);
    const maxX = Math.max(...fillRectCalls.map((c) => c.x + c.w));
    expect(maxX).toBeLessThanOrEqual(730);
  });

  it("Test 14 (Grok B-02): Canvas geometry — exactly 5 unique Y-row positions for 5y fixture", () => {
    const trimmed = buildFiveYearFixture().slice(0, 1825);
    render(<DailyHeatmap data={trimmed} />);
    const yValues = new Set(fillRectCalls.map((c) => c.y));
    expect(yValues.size).toBe(5);
  });

  /**
   * Phase 14b-02 / Grok W-01 — DailyHeatmap is wrapped with React.memo.
   * When a parent re-renders with the SAME data array reference, the inner
   * component is skipped (default shallow-compare on props) and the Canvas
   * useEffect does NOT re-run — fillRect spy stays at one full paint.
   */
  it("Test 15 (Grok W-01): React.memo skips re-render when data prop reference is stable", () => {
    const trimmed = buildFiveYearFixture().slice(0, 1825);
    // Wrapper that re-renders with a stable data reference on each
    // forceUpdate call. We expect Canvas paint to fire exactly ONCE
    // across two parent renders.
    function Parent({ tick, data }: { tick: number; data: { date: string; value: number }[] }) {
      // tick is read but unused — its sole role is to force a re-render
      // of the parent without changing the data prop reference.
      void tick;
      return <DailyHeatmap data={data} />;
    }
    const { rerender } = render(<Parent tick={0} data={trimmed} />);
    const afterFirstPaint = fillRectCalls.length;
    expect(afterFirstPaint).toBe(1825);
    // Re-render with the SAME data reference but a different tick.
    rerender(<Parent tick={1} data={trimmed} />);
    rerender(<Parent tick={2} data={trimmed} />);
    // memo'd inner component skips → no additional fillRect calls.
    expect(fillRectCalls.length).toBe(afterFirstPaint);
  });

  /**
   * Phase 14b-02 / Grok W-01 — when data identity changes (NEW reference,
   * even with identical content), React.memo's default shallow-compare
   * sees data !== prevData → component re-renders → Canvas re-paints.
   * This is the contract: data identity drives re-paint.
   */
  it("Test 16 (Grok W-01): data identity change re-paints the Canvas", () => {
    const trimmed1 = buildFiveYearFixture().slice(0, 1825);
    const { rerender } = render(<DailyHeatmap data={trimmed1} />);
    const afterFirstPaint = fillRectCalls.length;
    expect(afterFirstPaint).toBe(1825);
    // Same content, NEW array reference → re-paint expected.
    const trimmed2 = trimmed1.slice();
    rerender(<DailyHeatmap data={trimmed2} />);
    expect(fillRectCalls.length).toBe(afterFirstPaint + 1825);
  });
});
