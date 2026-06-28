import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DailyHeatmap, SVG_THRESHOLD_CELLS } from "./DailyHeatmap";

// Phase 47-03 — the SvgRenderer now reads useBreakpoint for the mobile
// legibility branch + consumes useTapPin for touch tap-reveal. Mock the
// breakpoint seam so the new isMobile conditional can be driven to BOTH arms
// in-wave (holds the branch-coverage ratchet). Default "desktop" in beforeEach
// so every pre-existing assertion (baked-tint fills, <title> format, canvas
// ordering) keeps its desktop-render expectation.
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
import { useBreakpoint } from "@/hooks/useBreakpoint";
const mockedUseBreakpoint = vi.mocked(useBreakpoint);

/**
 * Phase 14b / KPI-07 — DailyHeatmap dual SVG/Canvas renderer tests.
 *
 * 14 acceptance criteria from 14b-01-PLAN Task 2:
 *  1. SVG branch when data.length === 30 (≤365 cells)
 *  2. Canvas branch when data.length === 1825 (5y, > 365 cells); offscreen <table> mirror present
 *  3. SVG cell with value > 0.10 → fill="#15803D" (saturated positive)
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

interface ClearRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

type CanvasOp =
  | { op: "save" }
  | { op: "restore" }
  | { op: "clearRect"; args: ClearRectCall }
  | { op: "fillRect"; args: { x: number; y: number; w: number; h: number } };

let fillRectCalls: FillRectCall[] = [];
let clearRectCalls: ClearRectCall[] = [];
let saveCalls = 0;
let restoreCalls = 0;
let canvasOps: CanvasOp[] = [];
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

function installCanvasMock() {
  fillRectCalls = [];
  clearRectCalls = [];
  saveCalls = 0;
  restoreCalls = 0;
  canvasOps = [];
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
      canvasOps.push({ op: "fillRect", args: { x, y, w, h } });
    },
    // SR-2 (v0.17.1): the per-paint save/restore pair isolates globalAlpha
    // mutations on the canvas context. Tracked via saveCalls/restoreCalls
    // counters and the canvasOps sequence log so Test 17 can assert
    // ordering. Production code uses the real CanvasRenderingContext2D.
    save() {
      saveCalls += 1;
      canvasOps.push({ op: "save" });
    },
    restore() {
      restoreCalls += 1;
      canvasOps.push({ op: "restore" });
    },
    // SR-2 follow-up: paint loop clears stale pixels before redrawing so
    // subsetted data doesn't leave ghost cells. Tracked so Test 17 can
    // assert dimensions and Test 18 can assert re-paint behavior.
    clearRect(x: number, y: number, w: number, h: number) {
      clearRectCalls.push({ x, y, w, h });
      canvasOps.push({ op: "clearRect", args: { x, y, w, h } });
    },
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => fakeCtx) as never;
}

function restoreCanvasMock() {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  fillRectCalls = [];
  clearRectCalls = [];
  saveCalls = 0;
  restoreCalls = 0;
  canvasOps = [];
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
  mockedUseBreakpoint.mockReturnValue("desktop");
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

  it("Test 3: SVG cell with value > 0.10 has saturated baked-tint fill='#166534' and no fill-opacity", () => {
    const data = [{ date: "2024-01-01", value: 0.15 }];
    const { container } = render(<DailyHeatmap data={data} />);
    const rect = container.querySelector("svg rect[data-cell]");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("fill")).toBe("#166534");
    // PR #108 follow-up: per-shape opacity is gone — the prior `fillOpacity`
    // pattern alpha-blends through to the surface and collapses contrast.
    expect(rect?.getAttribute("fill-opacity")).toBeNull();
  });

  it("Test 4: SVG cell with value < -0.10 has saturated baked-tint fill='#991B1B' and no fill-opacity", () => {
    const data = [{ date: "2024-01-01", value: -0.15 }];
    const { container } = render(<DailyHeatmap data={data} />);
    const rect = container.querySelector("svg rect[data-cell]");
    expect(rect?.getAttribute("fill")).toBe("#991B1B");
    expect(rect?.getAttribute("fill-opacity")).toBeNull();
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

  it("Test 10: 9-step baked-tint diverging color scale across [+0.15, +0.07, +0.03, +0.01, 0, -0.01, -0.03, -0.07, -0.15]", () => {
    // PR #108 follow-up: tints baked into hex (no fill-opacity) so each
    // bucket pair clears WCAG AA on the white surface beneath. Mirrors the
    // chart-tokens.ts ramp that MonthlyHeatmap also consumes.
    const cases: Array<{ value: number; fill: string }> = [
      { value: 0.15, fill: "#166534" }, // CHART_POSITIVE_800
      { value: 0.07, fill: "#15803D" }, // CHART_POSITIVE_700
      { value: 0.03, fill: "#86EFAC" }, // CHART_POSITIVE_300
      { value: 0.01, fill: "#DCFCE7" }, // CHART_POSITIVE_100
      { value: 0, fill: "#FFFFFF" }, // CHART_NEUTRAL
      { value: -0.01, fill: "#FEE2E2" }, // CHART_NEGATIVE_100
      { value: -0.03, fill: "#FCA5A5" }, // CHART_NEGATIVE_300
      { value: -0.07, fill: "#B91C1C" }, // CHART_NEGATIVE_700
      { value: -0.15, fill: "#991B1B" }, // CHART_NEGATIVE_800
    ];
    for (const c of cases) {
      const { container, unmount } = render(
        <DailyHeatmap data={[{ date: "2024-01-01", value: c.value }]} />,
      );
      const rect = container.querySelector("svg rect[data-cell]");
      expect(rect?.getAttribute("fill")).toBe(c.fill);
      // No alpha attribute — baked into the hex.
      expect(rect?.getAttribute("fill-opacity")).toBeNull();
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

  /**
   * SR-2 (v0.17.1) — the Canvas paint loop must isolate per-cell
   * globalAlpha mutations and clear stale pixels before redraw. Without
   * the save/restore pair, the final cell's alpha leaks into any
   * subsequent draw on this context. Without clearRect, a re-paint with
   * shrunk data leaves ghost cells from the prior paint visible.
   *
   * Coverage audit GAP-2 + GAP-3: the prior tests mocked save/restore/
   * clearRect as no-ops without asserting they were called, so removing
   * any of those three lines from CanvasRenderer would silently pass.
   */
  it("Test 17 (SR-2): Canvas paint wraps fillRects in save/restore and clears canvas first", () => {
    const trimmed = buildFiveYearFixture().slice(0, 1825);
    render(<DailyHeatmap data={trimmed} />);

    // One save + one restore per paint.
    expect(saveCalls).toBe(1);
    expect(restoreCalls).toBe(1);

    // Exactly one full-canvas clear per paint.
    expect(clearRectCalls.length).toBe(1);
    // 5 unique years × CELL_H(80) = 400px tall, 365 cols × CELL_W(2) = 730px.
    expect(clearRectCalls[0]).toEqual({ x: 0, y: 0, w: 730, h: 5 * 80 });

    // Ordering: save → clearRect → fillRect+ → restore. The first op is
    // save; the second is clearRect; the last is restore; every op
    // between clearRect and restore is fillRect.
    expect(canvasOps[0]).toEqual({ op: "save" });
    expect(canvasOps[1].op).toBe("clearRect");
    expect(canvasOps[canvasOps.length - 1]).toEqual({ op: "restore" });
    const between = canvasOps.slice(2, -1);
    expect(between.length).toBe(1825);
    for (const op of between) {
      expect(op.op).toBe("fillRect");
    }
  });

  it("Test 18 (SR-2 follow-up): re-paint with new data identity re-clears the canvas", () => {
    const trimmed1 = buildFiveYearFixture().slice(0, 1825);
    const { rerender } = render(<DailyHeatmap data={trimmed1} />);
    expect(clearRectCalls.length).toBe(1);
    expect(saveCalls).toBe(1);
    expect(restoreCalls).toBe(1);

    // New array identity, same year set → React.memo invalidates → re-paint.
    // The stale-pixel hazard is real here: canvas dimensions don't change
    // (same year set), so the canvas does NOT auto-clear via attr change.
    // clearRect is what wipes the prior paint.
    const trimmed2 = trimmed1.slice();
    rerender(<DailyHeatmap data={trimmed2} />);

    expect(clearRectCalls.length).toBe(2);
    expect(clearRectCalls[1]).toEqual({ x: 0, y: 0, w: 730, h: 5 * 80 });
    expect(saveCalls).toBe(2);
    expect(restoreCalls).toBe(2);
  });

  /**
   * F5 (v0.17.1) — when document.fonts reports status='loading', the
   * Canvas paint loop must defer fillRect calls until document.fonts.ready
   * resolves. Painting before fonts settle races a layout reflow on cold
   * loads and leaves the cells visibly misaligned for one frame.
   *
   * Without this gate, the synchronous tests above (7, 9, 13–18) would
   * still pass — jsdom reports status='loaded' so the synchronous fast
   * path fires. This test installs a controlled FontFaceSet stub with
   * status='loading' to exercise the gated branch directly.
   */
  it("Test 19 (F5): canvas paint defers until document.fonts.ready when status='loading'", async () => {
    const trimmed = buildFiveYearFixture().slice(0, 1825);

    let release: () => void = () => {};
    const readyPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fakeFonts = { status: "loading" as const, ready: readyPromise };
    Object.defineProperty(document, "fonts", {
      value: fakeFonts,
      configurable: true,
      writable: true,
    });

    try {
      render(<DailyHeatmap data={trimmed} />);
      // Gate is closed — no fillRect calls until fonts.ready resolves.
      expect(fillRectCalls.length).toBe(0);
      expect(saveCalls).toBe(0);
      expect(clearRectCalls.length).toBe(0);

      // Open the gate.
      release();
      await readyPromise;
      // Extra microtask hop so the .then(paint) callback drains.
      await Promise.resolve();

      // Full paint completed.
      expect(fillRectCalls.length).toBe(1825);
      expect(saveCalls).toBe(1);
      expect(restoreCalls).toBe(1);
      expect(clearRectCalls.length).toBe(1);
    } finally {
      // Drop the override; prototype's FontFaceSet (if any) takes over again.
      // Cast through `unknown` because Document.fonts is non-optional in the
      // DOM lib types and TypeScript blocks `delete` on non-optional members.
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });
});

/**
 * Phase 47-03 / CHART-01a + CHART-02 + CHART-03 — the SVG branch grew an
 * `isMobile` legibility/scroll conditional + a `useTapPin` touch tap-reveal.
 * These tests exercise BOTH viewport arms IN THIS WAVE (the branch-coverage
 * ratchet, branches ≥ 72, is a BLOCKING CI gate) and prove:
 *   - desktop render byte-identity: the <title> format + baked-tint fills are
 *     unchanged when isMobile=false (a desktop literal mutation would FAIL);
 *   - keep-all-cells: the mobile render emits the SAME data-cell count as
 *     desktop (no row/col drop at 320px);
 *   - the touch tap path pins a reveal whose text equals the existing
 *     `"{ISO}: {pct}%"` <title> format (no new string).
 * Reuses the existing harness/fixtures — zero net-new deps.
 */
describe("DailyHeatmap — Phase 47-03 viewport branches + tap-reveal (SVG branch)", () => {
  // A small ≤365-cell fixture → SVG branch. One value per the baked ramp so the
  // desktop fill assertion is falsifiable against chart-tokens.
  function svgFixture(): { date: string; value: number }[] {
    return [
      { date: "2024-01-01", value: 0.15 }, // CHART_POSITIVE_800 #166534
      { date: "2024-03-15", value: 0 }, // CHART_NEUTRAL #FFFFFF
      { date: "2024-06-30", value: -0.15 }, // CHART_NEGATIVE_800 #991B1B
    ];
  }

  it("renders the SVG branch on the desktop arm (isMobile=false) with the literal 12px axis font + unchanged baked fills", () => {
    mockedUseBreakpoint.mockReturnValue("desktop");
    const { container } = render(<DailyHeatmap data={svgFixture()} />);
    // Desktop byte-identity: axis fontSize literal stays 12 (a mobile-only bump
    // must NOT leak into the desktop render).
    const monthLabel = container.querySelector('svg text[data-axis="month"]');
    expect(monthLabel?.getAttribute("font-size")).toBe("12");
    const yearLabel = container.querySelector('svg text[data-axis="year"]');
    expect(yearLabel?.getAttribute("font-size")).toBe("12");
    // Baked-tint fills unchanged + still no fill-opacity (PR #108 invariant).
    const cells = container.querySelectorAll("svg rect[data-cell]");
    const fills = Array.from(cells).map((c) => c.getAttribute("fill"));
    expect(fills).toEqual(["#166534", "#FFFFFF", "#991B1B"]);
    for (const c of cells) expect(c.getAttribute("fill-opacity")).toBeNull();
    // <title> format intact.
    const title = container.querySelector("svg title");
    expect(title?.textContent).toBe("2024-01-01: 15.00%");
  });

  it("renders the SVG branch on the mobile arm (isMobile=true) with a bumped axis font and the SAME cell count (no row/col drop)", () => {
    mockedUseBreakpoint.mockReturnValue("desktop");
    const dCount = render(<DailyHeatmap data={svgFixture()} />).container.querySelectorAll(
      "svg rect[data-cell]",
    ).length;

    mockedUseBreakpoint.mockReturnValue("mobile");
    const { container } = render(<DailyHeatmap data={svgFixture()} />);
    const mCells = container.querySelectorAll("svg rect[data-cell]");
    // Keep-all-cells: identical cell count on mobile (CHART-03 no row/col drop).
    expect(mCells.length).toBe(dCount);
    expect(mCells.length).toBe(3);
    // Mobile legibility: axis font is bumped above the desktop literal 12.
    const monthLabel = container.querySelector('svg text[data-axis="month"]');
    expect(Number(monthLabel?.getAttribute("font-size"))).toBeGreaterThan(12);
    // <title> format is the SAME on mobile (value source unchanged).
    const title = container.querySelector("svg title");
    expect(title?.textContent).toBe("2024-01-01: 15.00%");
  });

  it("a synthetic touch tap pins a reveal whose text equals the existing \"{ISO}: {pct}%\" <title> format", () => {
    mockedUseBreakpoint.mockReturnValue("mobile");
    const data = svgFixture();
    const { container } = render(<DailyHeatmap data={data} />);
    const svg = container.querySelector("svg")!;
    expect(svg).not.toBeNull();

    // Geometry (mirrors SvgRenderer): width = 56 + 365*2 = 786; the first cell
    // (2024-01-01, doy 0) sits at x≈56 (+1 to land inside), row 0 at y≈24+8.
    // jsdom returns a 0-sized rect, so stub getBoundingClientRect to the viewBox
    // so the pointer→viewBox math resolves to a real cell.
    const width = 56 + 365 * 2;
    const height = 24 + 1 * 16 + 8;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;

    // A tap = pointerdown→pointerup at the same point, pointerType "touch",
    // within slop + < 350ms. Target the first cell's center (doy 0, row 0).
    const cx = 56 + 1; // just inside the day-0 column
    const cy = 24 + 8; // inside row 0 band
    // fireEvent wraps the dispatch in act() internally, so the tap-pin state
    // update flushes before the assertion below.
    fireEvent.pointerDown(svg, { clientX: cx, clientY: cy, pointerType: "touch", pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: cx, clientY: cy, pointerType: "touch", pointerId: 1 });

    const reveal = container.querySelector('svg text[data-tap-reveal="daily-heatmap"]');
    expect(reveal).not.toBeNull();
    // The pinned reveal reuses the <title> format exactly (no new string).
    expect(reveal?.textContent).toBe("2024-01-01: 15.00%");
  });

  it("does NOT show the pinned reveal by default (desktop mouse render)", () => {
    mockedUseBreakpoint.mockReturnValue("desktop");
    const { container } = render(<DailyHeatmap data={svgFixture()} />);
    expect(container.querySelector('svg text[data-tap-reveal="daily-heatmap"]')).toBeNull();
  });
});
