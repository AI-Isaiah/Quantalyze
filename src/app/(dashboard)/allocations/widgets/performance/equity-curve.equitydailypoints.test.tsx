import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import DrawdownChart, { deriveSnapshotDrawdowns } from "./DrawdownChart";
import EquityChartWidget from "./EquityChart";
import { TweaksProvider } from "../../context/TweaksContext";

// CustomRangePicker / chart chrome consume next/navigation transitively — stub
// so the widget mounts under jsdom without a router context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

/**
 * Phase 07 / 07-03 — parallel-prop test coverage for the f7 equityDailyPoints
 * prop on DrawdownChart.
 *
 * Spec (per VOICES-ACCEPTED f7):
 *   - When equityDailyPoints is PRESENT (including empty array [] — an
 *     explicit override), the widget renders from that prop and does NOT
 *     fall back to the strategies-derived compute.
 *   - When equityDailyPoints is ABSENT (undefined), the widget falls back
 *     to the existing buildCompositeReturns / computeCompositeCurve path.
 *
 * The test strategy is to:
 *   (a) feed a mismatched strategies[] + equityDailyPoints so the output
 *       is distinguishable (snapshot-derived path uses ascending value
 *       markers; strategies path produces a different curve);
 *   (b) inspect the rendered SVG data or empty-state text to distinguish
 *       the two paths without coupling to exact chart pixels.
 */

function makeDailyReturns(n: number, startDate = "2023-01-01") {
  const pts: Array<{ date: string; value: number }> = [];
  const d = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    const value = Math.sin(i * 0.7) * 0.02;
    pts.push({ date: dateStr, value });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const STRATEGIES_DATA: WidgetProps["data"] = {
  strategies: [
    {
      strategy_id: "s-1",
      weight: 1.0,
      strategy: {
        name: "Alpha Strategy",
        strategy_analytics: {
          daily_returns: makeDailyReturns(60),
        },
      },
    },
  ],
  portfolio: { created_at: "2023-01-01T00:00:00Z" },
  analytics: null,
};

const EMPTY_DATA: WidgetProps["data"] = {
  strategies: [],
  portfolio: null,
  analytics: null,
};

// 30 ascending snapshot-derived DailyPoints — distinguishable from the
// sinusoidal strategies-derived curve by visual inspection of the path.
const SNAPSHOT_POINTS: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 2, i + 1)).toISOString().slice(0, 10),
  value: 1 + i * 0.01,
}));

const baseProps: Omit<WidgetProps, "data"> = {
  timeframe: "ALL" as const,
  width: 6,
  height: 4,
};

describe("DrawdownChart — equityDailyPoints parallel-prop (f7)", () => {
  it("(a) when equityDailyPoints is provided, widget renders (snapshot-derived path)", () => {
    const { queryByText } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={SNAPSHOT_POINTS}
      />,
    );
    // Empty strategies + no prop would render "No drawdown data available";
    // with the prop, the path is populated and the empty text is absent.
    expect(queryByText(/no drawdown data/i)).toBeNull();
  });

  it("(b) when equityDailyPoints is absent, widget falls back to strategies-derived compute", () => {
    const { queryByText } = render(
      <DrawdownChart {...baseProps} data={STRATEGIES_DATA} />,
    );
    expect(queryByText(/no drawdown data/i)).toBeNull();
  });

  it("(c) when equityDailyPoints === [], widget renders empty state instead of falling back to strategies", () => {
    const { queryByText } = render(
      <DrawdownChart
        {...baseProps}
        data={STRATEGIES_DATA}
        equityDailyPoints={[]}
      />,
    );
    expect(queryByText(/no drawdown data/i)).not.toBeNull();
  });

});

// Phase 07 / WR-01 regression — direct unit tests for the pure drawdown
// derivation. Under the pre-fix logic `let peak = points[0].value`, a
// leading 0 or negative value makes the first iteration's
// `(d.value - peak) / peak` evaluate to NaN (0/0) or Infinity (-50/0 →
// Infinity would feed to recharts and distort axes). Seeding peak at
// `max(first, 0)` keeps the series finite and clamps the first drawdown
// to 0 (no loss from a zero/negative baseline).
describe("deriveSnapshotDrawdowns — WR-01 boundary regression", () => {
  it("leading 0 value produces a finite series starting at 0", () => {
    const result = deriveSnapshotDrawdowns([
      { date: "2026-03-01", value: 0 },
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-03", value: 100 },
      { date: "2026-03-04", value: 90 },
    ]);
    for (const p of result) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(Number.isNaN(p.value)).toBe(false);
    }
    // First drawdown is 0 (peak seeded at max(0,0)=0, then `peak > 0`
    // guard short-circuits to 0 before a new peak is established).
    expect(result[0].value).toBe(0);
    // Once a positive value establishes a real peak (100 on day 3),
    // subsequent drops compute correctly: 90 vs peak 100 → -0.10.
    expect(result[3].value).toBeCloseTo(-0.1, 10);
  });

  it("leading negative value produces a finite series (no Infinity)", () => {
    const result = deriveSnapshotDrawdowns([
      { date: "2026-03-01", value: -50 },
      { date: "2026-03-02", value: 100 },
      { date: "2026-03-03", value: 80 },
    ]);
    for (const p of result) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(Number.isNaN(p.value)).toBe(false);
    }
    // Seeded peak is max(-50, 0) = 0. The first point value=-50 with
    // peak=0 takes the `peak > 0 ? ... : 0` branch → 0 (not Infinity).
    expect(result[0].value).toBe(0);
    // Then peak becomes 100 on day 2, so day 3 drawdown is (80-100)/100.
    expect(result[2].value).toBeCloseTo(-0.2, 10);
  });

  it("empty input returns empty array", () => {
    expect(deriveSnapshotDrawdowns([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 115.1 / RD-2 — EquityChartWidget provenance indicator render states.
//
// The producer (queries.ts:derivePhase07Fields) decides derived-vs-legacy and
// stamps `equityCurveSource`; the widget renders an HONEST indicator off it.
// These pins prove: (1) a derived-trustworthy source renders the derived label,
// (2) a legacy source renders the plainer legacy label and NEVER the
// api_verified-grade treatment (the RD-2 honesty invariant).
// ---------------------------------------------------------------------------

// A Map-backed localStorage stub (jsdom's shim is partial) so TweaksProvider
// hydrates cleanly. Registered via vi.stubGlobal so vi.unstubAllGlobals() in
// afterEach fully removes it — the Node-22 leaked-stub class
// (reference_ci_node22_vs_local_node25).
function makeLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: () => null,
    length: 0,
  } as Storage;
}

// A positive-anchored dense series so the inner chart mounts (not warm-up).
function makeSeries(n: number, start = 100_000): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2026, 0, 1));
  let v = start;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: v });
    v *= 1.002;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

describe("EquityChartWidget — equity provenance indicator (115.1 / RD-2)", () => {
  afterEach(() => {
    // Node-22 leaked-stub hygiene: fully undo the localStorage stub.
    vi.unstubAllGlobals();
  });

  function renderWidget(data: Record<string, unknown>) {
    vi.stubGlobal("localStorage", makeLocalStorageStub());
    return render(
      <TweaksProvider>
        <EquityChartWidget
          data={data as unknown as WidgetProps["data"]}
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
  }

  it("derived source → renders the derived provenance label", () => {
    const { getByTestId } = renderWidget({
      equityDailyPoints: makeSeries(60),
      equityCurveSource: "derived",
      derivedCurveComputedAt: "2026-03-13T00:00:00Z",
    });
    const provenance = getByTestId("equity-provenance");
    expect(provenance).toHaveAttribute("data-source", "derived");
    expect(provenance.textContent).toMatch(/Derived from per-key returns/i);
    // L2 (hydration safety): on the first render `now` is null (SSR/CSR parity —
    // the minute-tick effect defers via setTimeout(0), not yet fired here). The
    // toLocaleString() title is GATED on now !== null exactly like the visible
    // freshness text, so it must be ABSENT in this state — an ungated title emits
    // a timezone-dependent string that differs server(UTC)-vs-client → a hydration
    // attribute mismatch. Pre-fix (ungated) this attribute was present → RED.
    expect(provenance).not.toHaveAttribute("title");
  });

  it("legacy source → renders the legacy label and is NEVER api_verified-styled", () => {
    const { getByTestId, queryByText } = renderWidget({
      equityDailyPoints: makeSeries(60),
      equityCurveSource: "legacy",
      derivedCurveComputedAt: null,
    });
    const provenance = getByTestId("equity-provenance");
    expect(provenance).toHaveAttribute("data-source", "legacy");
    expect(provenance.textContent).toMatch(/Broker snapshot history/i);
    // The HARD RULE (RD-2): a legacy-fallback curve must not read as
    // verified-grade — no api_verified label anywhere on the surface.
    expect(queryByText(/api[\s_-]?verified/i)).toBeNull();
    expect(provenance.textContent).not.toMatch(/Derived from per-key/i);
  });

  it("absent source field → defaults to the legacy label (warm-up / first-connect safety)", () => {
    const { getByTestId } = renderWidget({
      equityDailyPoints: makeSeries(60),
    });
    const provenance = getByTestId("equity-provenance");
    expect(provenance).toHaveAttribute("data-source", "legacy");
    expect(provenance.textContent).toMatch(/Broker snapshot history/i);
  });
});
