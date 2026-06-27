import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { MonteCarloBandPoint } from "../lib/scenario-montecarlo";

/**
 * Plan 27-02 — the band chart renders the data (outer + inner band + median) and
 * names itself for assistive tech without becoming a focus stop. It is purely
 * presentational; the honesty/correctness pins live in the lib test.
 *
 * Phase 47 Plan 04 / CHART-02 + CHART-03 — legibility + portrait + desktop
 * byte-identity, proven by a Vitest COMPONENT render (NOT a Playwright golden).
 *
 * Why a component test rather than a Playwright golden (RESEARCH Pitfall 4): the
 * seeded allocator route renders 0 synced positions, and ScenarioComposer needs
 * >=2 strategies to render the Monte Carlo fan, so MonteCarloBandChart never
 * appears on the seeded e2e route. Its desktop byte-identity (the no-recompute
 * proof) is therefore guarded HERE by a props-only render with a deterministic
 * synthetic `MonteCarloBandPoint[]` — analog of DailyHeatmap.test.tsx.
 *
 * The chart grew an `isMobile ? mobileValue : todaysLiteral` conditional
 * (viewBox height + tick fontSize) when wrapped in ResponsiveChartFrame. The
 * branch-coverage ratchet (vitest.config.ts branches >= 72) is a BLOCKING CI
 * gate, so BOTH arms are rendered in THIS wave by mocking `useBreakpoint`.
 */

// Mock the breakpoint seam so each render deterministically picks a branch.
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { MonteCarloBandChart } from "./MonteCarloBandChart";

const mockedUseBreakpoint = vi.mocked(useBreakpoint);

function setBreakpoint(bp: "mobile" | "tablet" | "desktop") {
  mockedUseBreakpoint.mockReturnValue(bp);
}

function bands(n: number): MonteCarloBandPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const w = (i + 1) / n; // widening fan
    return {
      step: i + 1,
      q: { p5: -0.1 * w, p25: -0.05 * w, p50: 0.01 * w, p75: 0.06 * w, p95: 0.12 * w },
    };
  });
}

describe("MonteCarloBandChart", () => {
  beforeEach(() => {
    setBreakpoint("desktop");
  });

  it("renders the outer band, inner band, and median path", () => {
    const { getByTestId } = render(<MonteCarloBandChart bands={bands(60)} />);
    expect(getByTestId("montecarlo-band-chart")).toBeInTheDocument();
    expect(getByTestId("mc-band-outer")).toBeInTheDocument();
    expect(getByTestId("mc-band-inner")).toBeInTheDocument();
    expect(getByTestId("mc-median")).toBeInTheDocument();
  });

  it("is role=img with a text alt (named, not an empty keyboard focus stop)", () => {
    const { getByRole } = render(<MonteCarloBandChart bands={bands(60)} />);
    const svg = getByRole("img");
    expect(svg).toHaveAttribute("aria-label", expect.stringContaining("interval"));
    expect(svg).not.toHaveAttribute("tabindex");
  });

  it("renders nothing for empty bands (the caller gates)", () => {
    const { container } = render(<MonteCarloBandChart bands={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Phase 47 DESKTOP: role=img + NO tabIndex, paths render, viewBox 0 0 600 240 + tick fontSize=12 (byte-identity)", () => {
    setBreakpoint("desktop");
    const { container } = render(<MonteCarloBandChart bands={bands(60)} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();

    // a11y contract: role=img by DESIGN, never an empty keyboard focus stop.
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toMatch(/Forward confidence bands/);
    expect(svg?.getAttribute("tabindex")).toBeNull();

    // The fan renders its data: outer band, inner band, median line.
    expect(container.querySelector('[data-testid="mc-band-outer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mc-band-inner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mc-median"]')).not.toBeNull();

    // Desktop viewBox is today's literal (600 x 240) — mutating H_DESKTOP fails this.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 600 240");

    // Desktop tick fontSize is today's literal 12 (the no-recompute / byte-identity
    // proof for the chart that can't render on the seeded e2e route). Mutating the
    // 12 literal (e.g. -> 13) makes this assertion FAIL.
    const ticks = Array.from(container.querySelectorAll("text"));
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.getAttribute("font-size")).toBe("12");
    }
  });

  it("Phase 47 MOBILE: still role=img + NO tabIndex, tick fontSize bumped (>=18), taller viewBox (portrait)", () => {
    setBreakpoint("mobile");
    const { container } = render(<MonteCarloBandChart bands={bands(60)} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();

    // a11y contract preserved on mobile — still non-interactive.
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("tabindex")).toBeNull();

    // Taller mobile viewBox (portrait, CHART-03) — differs from the desktop literal.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 600 320");

    // Mobile tick fontSize is the bumped legibility value (CHART-02).
    const ticks = Array.from(container.querySelectorAll("text"));
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(18);
    }
  });

  it("Phase 47: the isMobile viewBox branch is LIVE — mobile viewBox differs from desktop", () => {
    setBreakpoint("desktop");
    const { container: desktop } = render(<MonteCarloBandChart bands={bands(60)} />);
    const desktopVB = desktop.querySelector("svg")?.getAttribute("viewBox");
    setBreakpoint("mobile");
    const { container: mobile } = render(<MonteCarloBandChart bands={bands(60)} />);
    const mobileVB = mobile.querySelector("svg")?.getAttribute("viewBox");
    expect(desktopVB).not.toBe(mobileVB);
  });
});
