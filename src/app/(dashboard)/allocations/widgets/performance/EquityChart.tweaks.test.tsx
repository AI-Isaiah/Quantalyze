import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { EquityChart } from "./EquityChart";
import { TweaksProvider } from "../../context/TweaksContext";

// ---------------------------------------------------------------------------
// H-1225 — EquityChart Tweaks-context wiring.
//
// PR3 gated the gradient-fill area path behind `chartStyle === "area"`
// (EquityChart.tsx:1132) and the benchmark dashed path + BTC legend chip
// behind `showBench` (EquityChart.tsx:969, 1088). Neither knob is exercised
// by EquityChart.test.tsx — both read defaults ("area" / true) outside a
// provider. These tests drive the knobs through a real TweaksProvider so a
// regression that hardcodes chartStyle="area" (or inverts showBench) fails.
//
// TweaksProvider hydrates from localStorage in a post-mount effect, so we
// seed `allocations.tweaks` before render and use waitFor to let hydration
// land. The runtime's `window.localStorage` (Node experimental shim under
// jsdom) only exposes get/set here, so we stub a complete Map-backed store —
// same idiom as Tweaks.test.tsx.
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

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsStore.set(k, v);
  },
  removeItem: (k: string) => {
    lsStore.delete(k);
  },
  clear: () => {
    lsStore.clear();
  },
  key: () => null,
  length: 0,
};
const realLocalStorage = window.localStorage;

function seedTweaks(partial: Record<string, unknown>): void {
  window.localStorage.setItem(
    "allocations.tweaks",
    JSON.stringify({
      density: "comfortable",
      accentIntensity: "muted",
      displayFont: "serif",
      bridgeVariant: "full",
      chartStyle: "area",
      showBench: true,
      showOutcomes: true,
      ...partial,
    }),
  );
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorageMock,
  });
  lsStore.clear();
});

afterAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: realLocalStorage,
  });
});

// The gradient-fill area path is the lone <path> with fill="url(#eq-grad)".
function areaPath(container: HTMLElement): SVGPathElement | null {
  return container.querySelector('svg path[fill="url(#eq-grad)"]');
}

describe("EquityChart — H-1225 chartStyle Tweaks knob", () => {
  it("chartStyle='area' (default) renders the gradient-fill area path", async () => {
    seedTweaks({ chartStyle: "area" });
    const { container } = render(
      <TweaksProvider>
        <EquityChart equityDailyPoints={makeSeries(120)} initialPeriod="ALL" />
      </TweaksProvider>,
    );
    await waitFor(() => {
      expect(areaPath(container)).not.toBeNull();
    });
  });

  it("chartStyle='line' removes the gradient-fill area path", async () => {
    seedTweaks({ chartStyle: "line" });
    const { container } = render(
      <TweaksProvider>
        <EquityChart equityDailyPoints={makeSeries(120)} initialPeriod="ALL" />
      </TweaksProvider>,
    );
    // Wait until hydration flips chartStyle → 'line' and drops the area path.
    await waitFor(() => {
      expect(areaPath(container)).toBeNull();
    });
    // The stroke-only portfolio line must still be present.
    const line = container.querySelector(
      'svg path[stroke="var(--color-chart-strategy)"]',
    );
    expect(line).not.toBeNull();
  });
});

describe("EquityChart — H-1225 showBench Tweaks knob", () => {
  it("showBench=true (default) renders the BTC legend chip + dashed benchmark path", async () => {
    seedTweaks({ showBench: true });
    const { container, getByLabelText } = render(
      <TweaksProvider>
        <EquityChart
          equityDailyPoints={makeSeries(120)}
          benchmark={makeSeries(120)}
          initialPeriod="ALL"
        />
      </TweaksProvider>,
    );
    await waitFor(() => {
      expect(
        container.querySelector('svg path[stroke-dasharray="3 3"]'),
      ).not.toBeNull();
    });
    expect(getByLabelText("Series legend").textContent).toMatch(/BTC/);
  });

  it("showBench=false hides BOTH the BTC legend chip and the dashed benchmark path", async () => {
    seedTweaks({ showBench: false });
    const { container, getByLabelText } = render(
      <TweaksProvider>
        <EquityChart
          equityDailyPoints={makeSeries(120)}
          benchmark={makeSeries(120)}
          initialPeriod="ALL"
        />
      </TweaksProvider>,
    );
    // Wait until hydration flips showBench → false and the dashed benchmark
    // path is gone.
    await waitFor(() => {
      expect(
        container.querySelector('svg path[stroke-dasharray="3 3"]'),
      ).toBeNull();
    });
    // Legend chip for BTC must also be absent.
    expect(getByLabelText("Series legend").textContent).not.toMatch(/BTC/);
  });
});
