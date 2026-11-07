import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { EquityChart } from "./EquityChart";

// ---------------------------------------------------------------------------
// Phase 195 D-05 — the equity chart's former Tweaks knobs are fixed defaults.
//
// The Tweaks panel (chart style, benchmark overlay) is gone. WHY these pins
// matter: the chart must always draw the gradient area fill and the BTC
// benchmark (legend chip + dashed path), and a value an allocator stored under
// `allocations.tweaks` while the panel existed must not hide either one
// (threat T-195-07, UI-SPEC S-6 defaults).
// ---------------------------------------------------------------------------

function makeSeries(n: number): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  let cumulative = 1.0;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: cumulative });
    cumulative *= 1 + Math.sin(i * 0.3) * 0.01;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// The gradient-fill area path is the lone <path> with fill="url(#eq-grad)".
function areaPath(container: HTMLElement): SVGPathElement | null {
  return container.querySelector('svg path[fill="url(#eq-grad)"]');
}

const STALE_TWEAKS = JSON.stringify({
  density: "tight",
  accentIntensity: "full",
  displayFont: "sans",
  bridgeVariant: "subtle",
  chartStyle: "line",
  showBench: false,
  showOutcomes: false,
});

describe("EquityChart — fixed defaults (Phase 195 D-05)", () => {
  // jsdom's localStorage is a Map-less shim here; a throwaway own-property
  // store keeps the stale-value seed isolated to this file.
  const store = new Map<string, string>();
  const realDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

  beforeEach(() => {
    store.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      },
    });
  });
  afterEach(() => {
    if (realDescriptor) Object.defineProperty(window, "localStorage", realDescriptor);
  });

  it("always renders the gradient-fill area path", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeSeries(120)} initialPeriod="ALL" />,
    );
    expect(areaPath(container)).not.toBeNull();
  });

  it("always renders the BTC legend chip and the dashed benchmark path", () => {
    const { container, getByLabelText } = render(
      <EquityChart
        equityDailyPoints={makeSeries(120)}
        benchmark={makeSeries(120)}
        initialPeriod="ALL"
      />,
    );
    expect(
      container.querySelector('svg path[stroke-dasharray="3 3"]'),
    ).not.toBeNull();
    expect(getByLabelText("Series legend").textContent).toMatch(/BTC/);
  });

  it("a stale stored chartStyle=line / showBench=false changes nothing", () => {
    window.localStorage.setItem("allocations.tweaks", STALE_TWEAKS);
    const { container, getByLabelText } = render(
      <EquityChart
        equityDailyPoints={makeSeries(120)}
        benchmark={makeSeries(120)}
        initialPeriod="ALL"
      />,
    );
    expect(areaPath(container)).not.toBeNull();
    expect(
      container.querySelector('svg path[stroke-dasharray="3 3"]'),
    ).not.toBeNull();
    expect(getByLabelText("Series legend").textContent).toMatch(/BTC/);
  });
});
