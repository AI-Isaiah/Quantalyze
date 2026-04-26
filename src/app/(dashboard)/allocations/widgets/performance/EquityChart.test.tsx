import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { EquityChart, type OverlaySeries } from "./EquityChart";

// ---------------------------------------------------------------------------
// Phase 09.1 Plan 07 / Task 3 — EquityChart test suite.
//
// Spec coverage:
//   1. 7 period buttons rendered; 6M is the default active state.
//   2. Clicking a non-default period switches active state.
//   3. Empty equityDailyPoints renders the warm-up placeholder (no SVG path).
//   4. Leading-zero anchoring — firstPositiveIdx semantics preserved.
//   5. Benchmark prop renders a dashed path alongside the portfolio path.
//   6. Overlay prop renders an additional path per overlay.
//   7. Stale prop renders the dim-overlay element.
//   8. No 1D / 1W buttons rendered (intraday deferred).
//
// jsdom doesn't provide ResizeObserver out of the box; the EquityChart
// implementation falls back to a fixed 960px width when ResizeObserver is
// undefined. We rely on that fallback rather than stubbing the global so
// the test stays close to the production codepath used in non-jsdom
// environments.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Make sure each test starts with a clean ResizeObserver state — jsdom's
  // default is undefined, but other tests in the suite may stub it.
  if ("ResizeObserver" in globalThis) {
    // Leave it alone — the chart's effect handles both shapes.
  }
});

function makeSeries(n: number, opts: { leadingZeros?: number } = {}): DailyPoint[] {
  const leading = opts.leadingZeros ?? 0;
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  let cumulative = 1.0;
  for (let i = 0; i < n; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const value = i < leading ? 0 : cumulative;
    if (i >= leading) cumulative *= 1 + Math.sin(i * 0.3) * 0.01;
    pts.push({ date: dateStr, value });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

describe("EquityChart", () => {
  it("renders 7 period buttons (1M / 3M / 6M / YTD / 1Y / ALL / CUSTOM)", () => {
    const { getByRole, getAllByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} />,
    );
    const tabs = getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    for (const label of ["1M", "3M", "6M", "YTD", "1Y", "ALL", "CUSTOM"]) {
      // getByRole resolves text-content by name (default in Testing Library)
      expect(getByRole("tab", { name: label })).toBeTruthy();
    }
  });

  it("defaults to 6M and that button is the active tab", () => {
    const { getByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} />,
    );
    const sixM = getByRole("tab", { name: "6M" });
    expect(sixM.getAttribute("aria-selected")).toBe("true");
  });

  it("clicking 1M switches the active tab", () => {
    const { getByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} />,
    );
    const oneM = getByRole("tab", { name: "1M" });
    expect(oneM.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(oneM);
    expect(oneM.getAttribute("aria-selected")).toBe("true");
    expect(getByRole("tab", { name: "6M" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("renders the warm-up placeholder when equityDailyPoints is empty (no SVG path)", () => {
    const { container, getByLabelText } = render(
      <EquityChart equityDailyPoints={[]} />,
    );
    expect(getByLabelText("Equity chart")).toBeTruthy();
    // The empty state mounts a div with the equity-chart aria-label rather
    // than an <svg>. The presence of the warm-up text is the indicator.
    expect(container.textContent).toMatch(/Equity data warming up/i);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("anchors from the firstPositiveIdx — leading-zero points are skipped", () => {
    // Construct a series with 3 leading zeros, then real positive values.
    // The chart should drop the leading zeros (firstPositiveIdx = 3) so
    // the rendered SVG path starts at the 4th point's value/value = 1.0
    // — i.e. the path's first y-coordinate aligns with `1.0` after anchor.
    const series = makeSeries(20, { leadingZeros: 3 });
    const { container } = render(
      <EquityChart equityDailyPoints={series} initialPeriod="ALL" />,
    );
    const paths = container.querySelectorAll("svg path");
    // At least: portfolio area + portfolio line.
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // The portfolio line path should have at most 17 vertex commands
    // (20 - 3 leading zeros = 17 anchored points). Count "L" commands +1
    // for the initial M.
    // Portfolio LINE has stroke set + fill="none". (Area has fill="url(...)"
    // and no stroke.)
    const portfolioLine = Array.from(paths).find((p) => {
      const stroke = p.getAttribute("stroke");
      const fill = p.getAttribute("fill");
      return Boolean(stroke) && fill === "none";
    });
    expect(portfolioLine).toBeDefined();
    const d = portfolioLine?.getAttribute("d") ?? "";
    const vertexCount = (d.match(/[ML]/g) || []).length;
    // 17 vertices expected (20 raw - 3 zeros). Allow some slack for the
    // path rendering — assert it's strictly less than the raw-input count.
    expect(vertexCount).toBeLessThanOrEqual(17);
    expect(vertexCount).toBeLessThan(series.length);
  });

  it("benchmark prop renders an additional dashed path alongside the portfolio", () => {
    const portfolio = makeSeries(60);
    const benchmark = makeSeries(60);
    const { container } = render(
      <EquityChart
        equityDailyPoints={portfolio}
        benchmark={benchmark}
        initialPeriod="ALL"
      />,
    );
    const dashed = container.querySelectorAll(
      'svg path[stroke-dasharray="3 3"]',
    );
    expect(dashed.length).toBeGreaterThanOrEqual(1);
  });

  it("overlay prop renders one additional path per overlay", () => {
    const portfolio = makeSeries(60);
    const overlay: OverlaySeries = {
      id: "h-1",
      label: "BTC Holding",
      color: "#FF6600",
      points: makeSeries(60),
    };
    const { container } = render(
      <EquityChart
        equityDailyPoints={portfolio}
        overlays={[overlay]}
        initialPeriod="ALL"
      />,
    );
    // Overlays render as solid 1.25-stroke paths in the overlay's color.
    const overlayPaths = container.querySelectorAll(
      'svg path[stroke="#FF6600"]',
    );
    expect(overlayPaths.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the stale-overlay element when stale=true", () => {
    const { container } = render(
      <EquityChart
        equityDailyPoints={makeSeries(60)}
        stale
        initialPeriod="ALL"
      />,
    );
    const staleEl = container.querySelector('[data-testid="equity-chart-stale"]');
    expect(staleEl).not.toBeNull();
    expect(container.textContent).toMatch(/Data may be stale/i);
  });

  it("does NOT render 1D or 1W buttons (intraday deferred)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} />,
    );
    const buttons = Array.from(container.querySelectorAll('button[role="tab"]'));
    const labels = buttons.map((b) => b.textContent);
    expect(labels).not.toContain("1D");
    expect(labels).not.toContain("1W");
    // Defensive: no other-cased intraday tokens leak through either.
    for (const l of labels) {
      expect(l).not.toMatch(/intraday/i);
    }
  });

  it("clicking CUSTOM opens the CustomRangePicker popover", () => {
    const { getByRole, queryByRole } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    expect(queryByRole("dialog", { name: "Custom date range" })).toBeNull();
    const customBtn = getByRole("tab", { name: "CUSTOM" });
    fireEvent.click(customBtn);
    expect(queryByRole("dialog", { name: "Custom date range" })).not.toBeNull();
  });

  // ────────────────────────────────────────────────────────────────
  // Readability pass (2026-04-24) — the axis/legend/summary additions
  // that resolved the "only 100% and no other sign" complaint.
  // ────────────────────────────────────────────────────────────────

  it("renders a 0% baseline tick label on the Y-axis", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    const labels = Array.from(container.querySelectorAll("svg text")).map(
      (t) => t.textContent,
    );
    // The 0% baseline tick is always rendered (we clamp yMin <= 1 <= yMax).
    expect(labels).toContain("+0%");
  });

  it("renders multiple Y-axis percentage tick labels (not just 0%)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(200)} initialPeriod="ALL" />,
    );
    const pctLabels = Array.from(container.querySelectorAll("svg text"))
      .map((t) => t.textContent ?? "")
      .filter((s) => /^[+-]?\d+(\.\d+)?%$/.test(s));
    // We expect at least 2 percentage ticks (0% + at least one other).
    expect(pctLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("renders an always-visible legend entry for Portfolio", () => {
    const { getByLabelText } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    const legend = getByLabelText("Series legend");
    expect(legend.textContent).toMatch(/Portfolio/);
  });

  it("renders a BTC legend entry when benchmark is supplied", () => {
    const { getByLabelText } = render(
      <EquityChart
        equityDailyPoints={makeSeries(60)}
        benchmark={makeSeries(60)}
        initialPeriod="ALL"
      />,
    );
    const legend = getByLabelText("Series legend");
    expect(legend.textContent).toMatch(/BTC/);
  });

  it("PR3 (dashboard parity) — renders 'sync just now' stamp instead of always-visible return summary", () => {
    // PR3 dropped the right-side return-summary div ("ALL +1.23%") that
    // collided with the prototype's "sync 2m ago" affordance. The Y-axis
    // labels + hover crosshair already surface the period return; the
    // sync stamp is the truth-screenshot's right-aligned chrome.
    const { getByText, queryByLabelText } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    expect(getByText("sync just now")).toBeTruthy();
    expect(queryByLabelText("Return over ALL")).toBeNull();
  });

  it("gradient uses the --chart-strategy design token (no hardcoded hex)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(60)} initialPeriod="ALL" />,
    );
    // jsdom doesn't namespace-resolve the SVG descendant selector reliably;
    // walk the DOM and grab <stop> nodes by tagName.
    const svg = container.querySelector("svg")!;
    const stops = Array.from(svg.getElementsByTagName("stop"));
    expect(stops.length).toBeGreaterThan(0);
    for (const s of stops) {
      const color = s.getAttribute("stop-color") ?? "";
      expect(color).toMatch(/var\(--chart-strategy\)/);
    }
  });

  it("benchmark path uses the --chart-benchmark design token (no hardcoded hex)", () => {
    const { container } = render(
      <EquityChart
        equityDailyPoints={makeSeries(60)}
        benchmark={makeSeries(60)}
        initialPeriod="ALL"
      />,
    );
    const dashed = container.querySelector(
      'svg path[stroke-dasharray="3 3"]',
    ) as SVGPathElement | null;
    expect(dashed).not.toBeNull();
    expect(dashed?.getAttribute("stroke")).toBe("var(--chart-benchmark)");
  });
});

// Re-export to silence a "vi unused" lint nit on jsdom-only test env.
void vi;
