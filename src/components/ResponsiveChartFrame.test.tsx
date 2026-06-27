/** @vitest-environment jsdom */
/**
 * Phase 44 / A11Y-02 — structural byte-identity guard for ResponsiveChartFrame.
 *
 * The named e2e parity spec `e2e/strategy-v2-chart-parity.spec.ts` is
 * permanently `test.skip(true)`, targets the wrong route/stack, has no goldens,
 * and does NOT exercise TimeSeriesChart — so it CANNOT guard the extraction.
 * THIS structural unit test is the falsifiable guard: it pins the EXACT
 * attribute strings the frame must emit (so a silent drift fails CI loud) and
 * proves the passthrough contract Pitfall 4 depends on (ref + every caller prop
 * forwards to the underlying <svg>).
 *
 * Test plan:
 *  1. Recipe byte-identity at the live TimeSeriesChart dimensions (880 × 280):
 *     verbatim viewBox, preserveAspectRatio, `block w-full` className core,
 *     and the responsive style keys (aspect-ratio / max-height / width / height).
 *  2. Passthrough contract: ref resolves to the <svg> element; an arbitrary
 *     handler (onClick), aria-label, tabIndex, focusable, role, and data-testid
 *     all appear on the rendered svg unchanged.
 *  3. Adoption-parity (Task 2): the className the frame produces from
 *     `block w-full` + TimeSeriesChart's chart-specific classes equals the
 *     VERBATIM original full className string, so a future class-order drift in
 *     the svg→frame swap fails loud (RESEARCH Open Question 2 recommendation —
 *     cheaper + equally falsifiable as RTL-rendering the full chart).
 */
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { ResponsiveChartFrame } from "./ResponsiveChartFrame";

describe("[A11Y-02] ResponsiveChartFrame — verbatim responsive SVG recipe", () => {
  it("emits the EXACT TimeSeriesChart recipe at 880 × 280", () => {
    render(
      <ResponsiveChartFrame width={880} height={280} data-testid="frame">
        <rect data-testid="child" />
      </ResponsiveChartFrame>,
    );
    const svg = screen.getByTestId("frame");

    // String-equal so an attribute drift fails loud (not a substring check).
    expect(svg.getAttribute("viewBox")).toBe("0 0 880 280");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");

    // The load-bearing responsive className core.
    expect(svg.getAttribute("class")).toContain("block w-full");

    // The responsive style keys, verbatim. jsdom normalizes camelCase →
    // kebab-case; assert each declaration the recipe pins.
    const styleAttr = svg.getAttribute("style") ?? "";
    expect(styleAttr).toContain("aspect-ratio: 880 / 280");
    expect(styleAttr).toContain("max-height: 280px");
    expect(styleAttr).toContain("width: 100%");
    expect(styleAttr).toContain("height: auto");

    // Children render inside the frame.
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("forwards a ref to the underlying <svg> element", () => {
    const ref = createRef<SVGSVGElement>();
    render(<ResponsiveChartFrame ref={ref} width={880} height={280} data-testid="frame" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(screen.getByTestId("frame"));
    expect(ref.current?.tagName.toLowerCase()).toBe("svg");
  });

  it("passes through ALL caller props (handlers, aria, tabIndex, focusable, role)", () => {
    const onClick = vi.fn();
    render(
      <ResponsiveChartFrame
        width={880}
        height={280}
        data-testid="frame"
        role="img"
        aria-label="Cumulative return"
        aria-describedby="chart-help-x"
        tabIndex={0}
        focusable="true"
        onClick={onClick}
      />,
    );
    const svg = screen.getByTestId("frame");

    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Cumulative return");
    expect(svg.getAttribute("aria-describedby")).toBe("chart-help-x");
    expect(svg.getAttribute("tabindex")).toBe("0");
    expect(svg.getAttribute("focusable")).toBe("true");

    svg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("appends caller className AFTER the responsive core (no reordering)", () => {
    render(
      <ResponsiveChartFrame width={880} height={280} className="cursor-crosshair" data-testid="frame" />,
    );
    // `block w-full` MUST lead; caller class follows verbatim.
    expect(screen.getByTestId("frame").getAttribute("class")).toBe(
      "block w-full cursor-crosshair",
    );
  });

  it("merges caller style after the responsive keys without dropping them", () => {
    render(
      <ResponsiveChartFrame
        width={880}
        height={280}
        style={{ contentVisibility: "auto" }}
        data-testid="frame"
      />,
    );
    const styleAttr = screen.getByTestId("frame").getAttribute("style") ?? "";
    expect(styleAttr).toContain("aspect-ratio: 880 / 280");
    expect(styleAttr).toContain("content-visibility: auto");
  });

  it("[adoption parity] reconstitutes TimeSeriesChart's verbatim full className", () => {
    // The chart-specific className TimeSeriesChart passes to the frame (the
    // original svg className with the `block w-full` prefix removed — the frame
    // supplies that prefix).
    const CHART_CLASSES =
      "cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
    render(<ResponsiveChartFrame width={880} height={280} className={CHART_CLASSES} data-testid="frame" />);
    // Must equal the EXACT original full className from TimeSeriesChart.tsx:576.
    expect(screen.getByTestId("frame").getAttribute("class")).toBe(
      "block w-full cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    );
  });
});
