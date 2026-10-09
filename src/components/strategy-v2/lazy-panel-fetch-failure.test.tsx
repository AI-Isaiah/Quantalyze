import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * Phase 170.5 SFH-01 — a FAILED lazy-panel fetch is the retry banner, never a
 * say-why sentence.
 *
 * Drives the REAL chain: panel -> `useLazyPanelMetrics` -> real
 * `fetchStrategyLazyMetricsClient` -> a stubbed supabase `rpc`. Only the
 * transport (supabase client), the IntersectionObserver and the heavy chart
 * components are replaced; mocking the hook or the fetcher would let the very
 * defect under test (a failure resolving `{}` -> status "ready") pass.
 *
 * Panel 7 = ExposureAndGreeksPanel (say-why: "no position-snapshot exposure
 * series is stored for it"). Panel 5 = RollingMetricsPanel (say-why: "Rolling
 * alpha and beta are not computed for this strategy."). Both said those things
 * when the RPC errored, timed out, returned NULL or drifted shape, because the
 * client mirror collapsed every failure to `{}`.
 */

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: (...args: unknown[]) => rpcMock(...args) }),
}));

vi.mock("@/components/charts/NetGrossExposureChart", () => ({
  NetGrossExposureChart: () => <div data-testid="net-gross-chart" />,
}));
vi.mock("@/components/charts/TurnoverChart", () => ({
  TurnoverChart: () => <div data-testid="turnover-chart" />,
}));
vi.mock("@/components/charts/CorrelationWithBenchmark", async (importActual) => ({
  ...(await importActual<typeof import("@/components/charts/CorrelationWithBenchmark")>()),
  CorrelationWithBenchmark: () => <div data-testid="correlation-with-benchmark" />,
}));
vi.mock("./BenchmarkGreeksTable", () => ({
  BenchmarkGreeksTable: () => <div data-testid="benchmark-greeks-table" />,
}));
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: () => <div data-testid="rolling-metrics" />,
}));
vi.mock("@/components/charts/RollingVolatilityChart", () => ({
  RollingVolatilityChart: () => <div data-testid="rolling-volatility" />,
}));
vi.mock("@/components/charts/RollingSortinoChart", () => ({
  RollingSortinoChart: () => <div data-testid="rolling-sortino" />,
}));
vi.mock("@/components/charts/RollingAlphaBetaChart", () => ({
  RollingAlphaBetaChart: () => <div data-testid="rolling-alpha-beta" />,
}));

import { ExposureAndGreeksPanel } from "./ExposureAndGreeksPanel";
import { RollingMetricsPanel } from "./RollingMetricsPanel";

const BANNER_HEADING = "Couldn’t load this section";
const BANNER_BODY = "Refresh the page to retry. The other panels still work.";

// Fragments of the say-why sentences the panels print on an EMPTY payload.
const EXPOSURE_SAY_WHY = /Net and gross exposure isn’t available for this strategy/;
const TURNOVER_SAY_WHY = /no turnover series is computed for it/;
const ROLLING_SAY_WHY = /Rolling alpha and beta are not computed for this strategy/;

// Fires the intersection on a macrotask after the node is observed, so the
// panel's lazy fetch starts on mount without a real viewport. It must be
// ASYNC like a real observer: a synchronous fire inside the ref callback runs
// before the hook's mount effects and the hook's version guard then (correctly)
// drops the result as stale.
let originalIO: typeof IntersectionObserver | undefined;
function installAutoIntersectObserver() {
  originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  class AutoIntersect {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      setTimeout(() => {
        this.cb(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }, 0);
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    AutoIntersect as unknown as typeof IntersectionObserver;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rpcMock.mockReset();
  installAutoIntersectObserver();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  if (originalIO) {
    (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
      originalIO;
  }
});

const GREEKS = { alpha: 0.05, beta: 1.2, ir: 0.8, treynor: 0.04 };
const ANALYTICS = { returns_series: null, metrics_json: {} };

function renderExposure() {
  return render(
    <ExposureAndGreeksPanel
      strategyId="s1"
      history_days={365}
      benchmark_greeks={GREEKS}
      correlation_analytics={ANALYTICS}
    />,
  );
}

function renderRolling() {
  return render(
    <RollingMetricsPanel
      strategyId="s1"
      history_days={365}
      rolling_metrics={null}
      sharpe={null}
    />,
  );
}

// `banners` = how many retry banners one failed fetch draws. Panel 7 shows one
// for its exposure + turnover part; panel 5 shows ONE above its three lazy
// sub-sections (volatility, Sortino, alpha & beta), which render nothing on
// error (R3-02: one failed fetch must not look like three failures). Since
// Phase 170.5 R2-02 the banner no longer replaces the whole panel.
const PANELS = [
  { name: "panel 7 ExposureAndGreeksPanel", render: renderExposure, sayWhy: [EXPOSURE_SAY_WHY, TURNOVER_SAY_WHY], banners: 1 },
  { name: "panel 5 RollingMetricsPanel", render: renderRolling, sayWhy: [ROLLING_SAY_WHY], banners: 1 },
];

const FAILURES: [string, () => void][] = [
  [
    "the RPC returns an error (outage / timeout / revoked grant)",
    () =>
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied for function fetch_strategy_lazy_metrics" },
      }),
  ],
  ["the RPC call rejects (network failure)", () => rpcMock.mockRejectedValue(new Error("Failed to fetch"))],
  ["the RPC returns a SQL NULL payload", () => rpcMock.mockResolvedValue({ data: null, error: null })],
  ["the RPC returns an array (shape drift)", () => rpcMock.mockResolvedValue({ data: [], error: null })],
  ["the RPC returns a primitive (shape drift)", () => rpcMock.mockResolvedValue({ data: "boom", error: null })],
];

describe.each(PANELS)("$name: a failed lazy fetch", (panel) => {
  it.each(FAILURES)("shows the retry banner and no say-why sentence when %s", async (_label, arrange) => {
    arrange();
    const { container } = panel.render();

    expect(await screen.findAllByText(BANNER_HEADING, {}, { timeout: 5000 })).toHaveLength(panel.banners);
    expect(screen.getAllByText(BANNER_BODY)).toHaveLength(panel.banners);
    expect(container.querySelector("section")?.getAttribute("data-panel-status")).toBe("error");
    for (const sentence of panel.sayWhy) {
      expect(container.textContent ?? "").not.toMatch(sentence);
    }
  });
});

describe.each(PANELS)("$name: a valid empty payload", (panel) => {
  it("stays on the say-why path and never shows the retry banner", async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null });
    const { container } = panel.render();

    await waitFor(
      () =>
        expect(container.querySelector("section")?.getAttribute("data-panel-status")).toBe("ready"),
      { timeout: 5000 },
    );
    expect(container.textContent ?? "").toMatch(panel.sayWhy[0]);
    expect(screen.queryByText(BANNER_HEADING)).toBeNull();
    expect(screen.queryByText(BANNER_BODY)).toBeNull();
  });
});
