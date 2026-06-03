import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import EquityChartWidget from "./EquityChart";
import type { OverlaySeries } from "./EquityChart";
import { TweaksProvider } from "../../context/TweaksContext";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

// ---------------------------------------------------------------------------
// M-1068 — EquityChartWidget single-row header rendering paths.
//
// PR4 #1 lifted period/customRange/pickerOpen state into EquityChartWidget
// and added a ~180-line single-row header: title + HeaderLegendSwatch chips
// (Portfolio always; BTC when `showBench && hasBenchmark`; one per overlay) +
// period toggle + sync stamp ("data stale" vs "sync just now"). The whole
// point of the lift is that the inner <EquityChart> is rendered with
// `hideHeader`/`hideLegend` so the user does NOT see a duplicated header/
// legend row.
//
// The only prior coverage (EquityChart.v2.test.tsx) mocks WidgetState and
// asserts the "Equity curve" title renders — it never exercises the swatch
// conditionals, the stale stamp, or the hideHeader/hideLegend dedup. These
// tests pin those paths so a regression (e.g. dropping the `hideLegend`
// prop, or forwarding a stale `showBench`) surfaces loudly.
// ---------------------------------------------------------------------------

// next/navigation is consumed transitively by CustomRangePicker / chart
// chrome — stub so the widget mounts under jsdom without a router context.
import { vi } from "vitest";
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

// A small positive-anchored series so the inner chart mounts an <svg> (not
// the warm-up placeholder), which is what produces an inner legend row when
// hideLegend is NOT honored.
function makeSeries(n: number): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  let cumulative = 1.0;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: cumulative });
    cumulative *= 1.002;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// TweaksProvider hydrates `showBench` from localStorage in a post-mount
// effect. Stub a complete Map-backed store (jsdom's shim is partial) and
// seed before render, then use async queries that retry until hydration
// lands — same idiom as BridgeHeroWidget.test.tsx.
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

afterAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: realLocalStorage,
  });
});

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

describe("M-1068 — EquityChartWidget single-row header", () => {
  it("renders the 'Equity curve' title and an always-present Portfolio legend swatch in the header strip", () => {
    seedTweaks({});
    render(
      <TweaksProvider>
        <EquityChartWidget
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={{ equityDailyPoints: makeSeries(60) } as any}
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    expect(screen.getByText("Equity curve")).toBeInTheDocument();
    // The header strip carries aria-label="Series legend"; Portfolio chip is
    // unconditional inside it.
    const legend = screen.getByLabelText("Series legend");
    expect(within(legend).getByText("Portfolio")).toBeInTheDocument();
  });

  it("renders the BTC swatch when btcBenchmark is present AND showBench=true; hidden when showBench=false", async () => {
    // showBench defaults to true; assert BTC chip appears with a benchmark.
    seedTweaks({ showBench: true });
    const { unmount } = render(
      <TweaksProvider>
        <EquityChartWidget
          data={
            {
              equityDailyPoints: makeSeries(60),
              btcBenchmark: makeSeries(60),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    const legendOn = screen.getByLabelText("Series legend");
    expect(within(legendOn).getByText("BTC")).toBeInTheDocument();
    unmount();

    // showBench=false → BTC chip suppressed even though a benchmark exists.
    seedTweaks({ showBench: false });
    render(
      <TweaksProvider>
        <EquityChartWidget
          data={
            {
              equityDailyPoints: makeSeries(60),
              btcBenchmark: makeSeries(60),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    // The hydration effect flips showBench → false; wait for the BTC chip to
    // disappear from the (single) legend strip.
    await waitFor(() => {
      const legendOff = screen.getByLabelText("Series legend");
      expect(within(legendOff).queryByText("BTC")).toBeNull();
    });
  });

  it("does NOT render a BTC swatch when there is no benchmark, regardless of showBench", () => {
    seedTweaks({ showBench: true });
    render(
      <TweaksProvider>
        <EquityChartWidget
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={{ equityDailyPoints: makeSeries(60) } as any}
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    const legend = screen.getByLabelText("Series legend");
    expect(within(legend).queryByText("BTC")).toBeNull();
  });

  it("renders one HeaderLegendSwatch per equityOverlay (labels appear in the header strip)", () => {
    seedTweaks({});
    const overlays: OverlaySeries[] = [
      { id: "o1", label: "Momentum", color: "#FF6600", points: makeSeries(60) },
      { id: "o2", label: "Carry", color: "#00AAFF", points: makeSeries(60) },
    ];
    render(
      <TweaksProvider>
        <EquityChartWidget
          data={
            {
              equityDailyPoints: makeSeries(60),
              equityOverlays: overlays,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    const legend = screen.getByLabelText("Series legend");
    expect(within(legend).getByText("Momentum")).toBeInTheDocument();
    expect(within(legend).getByText("Carry")).toBeInTheDocument();
  });

  it("shows 'data stale' (and NOT 'sync just now') when allKeysStale=true with no lastSyncAt", () => {
    seedTweaks({});
    const { container } = render(
      <TweaksProvider>
        <EquityChartWidget
          data={
            {
              equityDailyPoints: makeSeries(60),
              allKeysStale: true,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    expect(container.textContent).toContain("data stale");
    expect(container.textContent).not.toContain("sync just now");
  });

  it("shows 'no sync yet' (NOT the 'sync just now' lie) when fresh with no lastSyncAt — B14 / NEW-C09-04 (H-1226)", () => {
    // A null/absent lastSyncAt with allKeysStale falsy is the genuine
    // never-synced state (e.g. a brand-new allocator who has not connected an
    // exchange). The producer (getMyAllocationDashboard) always plumbs
    // lastSyncAt, so this is NOT an unplumbed legacy call site. Rendering
    // "sync just now" here would claim a sync just completed when none ever
    // has — the exact staleness lie B14 exists to eliminate. The stamp must
    // surface the honest onboarding copy instead. This assertion FAILS against
    // the pre-fix `: "sync just now"` branch.
    seedTweaks({});
    const { container } = render(
      <TweaksProvider>
        <EquityChartWidget
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={{ equityDailyPoints: makeSeries(60) } as any}
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    expect(container.textContent).toContain("no sync yet");
    expect(container.textContent).not.toContain("sync just now");
    expect(container.textContent).not.toContain("data stale");
  });

  it("renders exactly ONE 'Series legend' strip — the inner EquityChart receives hideHeader/hideLegend so its own legend is suppressed (no duplicate row)", () => {
    seedTweaks({});
    const { container } = render(
      <TweaksProvider>
        <EquityChartWidget
          data={
            {
              equityDailyPoints: makeSeries(60),
              btcBenchmark: makeSeries(60),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    // If hideLegend were dropped, the inner chart would render its OWN
    // aria-label="Series legend" row and the user would see two legends.
    const legends = container.querySelectorAll('[aria-label="Series legend"]');
    expect(legends.length).toBe(1);
  });

  // H-1227: the widget-level CUSTOM picker is NOT behind the inner chart's
  // `if (!projection) return` guard — the period tabs render even on a
  // first-connect card with no equity history (empty equityDailyPoints). With
  // the empty `minDate` fallback as a wall-clock `new Date()` (e.g. 12:30) it
  // exceeded `max=localMidnightToday()` (00:00), inverting min>max so EVERY day
  // cell was disabled and Apply was permanently stuck — a dead popover. The fix
  // anchors the fallback to localMidnightToday() (== max) so today stays
  // selectable.
  it("empty-data CUSTOM picker stays usable (min<=max → at least one day cell selectable) [H-1227]", () => {
    seedTweaks({});
    render(
      <TweaksProvider>
        <EquityChartWidget
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={{ equityDailyPoints: [] } as any}
          timeframe="1YTD"
          width={6}
          height={4}
        />
      </TweaksProvider>,
    );
    // The header's period tabs render even while the inner chart body warms up.
    fireEvent.click(screen.getByRole("tab", { name: "CUSTOM" }));
    // Day-grid cells are <button>s whose label is a bare day-of-month number.
    const dayCells = screen
      .getAllByRole("button")
      .filter((b) => /^\d{1,2}$/.test((b.textContent ?? "").trim()));
    expect(dayCells.length).toBeGreaterThan(0);
    // Pre-fix (min>max) every cell was disabled; the fix keeps today selectable.
    expect(dayCells.some((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });
});
