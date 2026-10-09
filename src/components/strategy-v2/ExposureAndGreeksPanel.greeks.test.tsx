import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 170.5 plan 07 Task 3 (D-07, D-06) - the Benchmark greeks sub-section
 * follows the joint's status.
 *
 * Failure is not absence (UI-SPEC): a source that FAILED (`error`) or that the
 * page could not resolve (`needs_builder`) renders the retry banner, never five
 * dashes reading "not computed", so a transient failure never looks like a
 * permanent fact. A failed BTC price read is not that case: it is the
 * `benchmark_unavailable` status and reads its own rung.
 */

interface HookReturn {
  ref: (n: HTMLElement | null) => void;
  data: { exposure_series?: unknown; turnover_series?: unknown } | null;
  status: "idle" | "loading" | "ready" | "error";
}
let mockHookReturn: HookReturn = { ref: () => {}, data: {}, status: "ready" };
vi.mock("@/hooks/useLazyPanelMetrics", () => ({
  useLazyPanelMetrics: () => mockHookReturn,
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
let lastGreeksProps: Record<string, unknown> | null = null;
vi.mock("./BenchmarkGreeksTable", () => ({
  BenchmarkGreeksTable: (props: Record<string, unknown>) => {
    lastGreeksProps = props;
    return <div data-testid="benchmark-greeks-table" />;
  },
}));

import { ExposureAndGreeksPanel } from "./ExposureAndGreeksPanel";
import type { V2JointStatus } from "@/lib/factsheet/v2-joint";

const FULL = { alpha: 0.12, beta: 0.4, correlation: 0.5, ir: 0.3, treynor: 0.2 };
const NULLS = { alpha: null, beta: null, correlation: null, ir: null, treynor: null };
const ANALYTICS = { returns_series: null, metrics_json: {} };
const BANNER_HEADING = "Couldn’t load this section";
const BANNER_BODY = "Refresh the page to retry. The other panels still work.";

function renderPanel(
  greeks: Record<string, number | null>,
  joint?: V2JointStatus,
  opts: { historyDays?: number; lazyStatus?: HookReturn["status"] } = {},
) {
  mockHookReturn = { ref: () => {}, data: {}, status: opts.lazyStatus ?? "ready" };
  return render(
    <ExposureAndGreeksPanel
      strategyId="s1"
      history_days={opts.historyDays ?? 365}
      benchmark_greeks={greeks as never}
      benchmark_joint={joint}
      correlation_analytics={ANALYTICS}
    />,
  );
}

function greeksSection(container: HTMLElement): HTMLElement {
  const h3 = Array.from(container.querySelectorAll("h3")).find(
    (h) => h.textContent === "Benchmark greeks",
  );
  expect(h3).toBeDefined();
  return h3!.parentElement as HTMLElement;
}

beforeEach(() => {
  lastGreeksProps = null;
});

describe("ExposureAndGreeksPanel Benchmark greeks (D-07)", () => {
  it.each<V2JointStatus>([{ kind: "error" }, { kind: "needs_builder" }])(
    "%j renders the retry banner and not the table",
    (joint) => {
      const { container, queryByTestId } = renderPanel(NULLS, joint);
      const text = greeksSection(container).textContent ?? "";
      expect(text).toContain(BANNER_HEADING);
      expect(text).toContain(BANNER_BODY);
      expect(queryByTestId("benchmark-greeks-table")).toBeNull();
    },
  );

  it("an error in the greeks source leaves the other sub-sections rendering (true by construction on old code too)", () => {
    const { queryByTestId } = renderPanel(NULLS, { kind: "error" });
    // The rolling-correlation key is absent in this fixture, so the v2 say-why block shows.
    expect(queryByTestId("correlation-why")).not.toBeNull();
  });

  it("below_floor renders the table with the paired-floor reason", () => {
    renderPanel(NULLS, { kind: "below_floor", paired: 7, floor: 10 });
    expect(lastGreeksProps!.reason).toBe(
      "Alpha and beta need at least 10 days paired with BTC; this record has 7.",
    );
  });

  it("benchmark_unavailable renders the table with its own reason (a failed BTC read is not the error banner)", () => {
    const { container } = renderPanel(NULLS, { kind: "benchmark_unavailable" });
    expect(lastGreeksProps!.reason).toBe("BTC benchmark prices are unavailable for this record.");
    expect(greeksSection(container).textContent).not.toContain(BANNER_HEADING);
  });

  it("computed with five finite values passes reason null and all five values including correlation", () => {
    renderPanel(FULL, { kind: "computed", paired: 111, flatLeg: false });
    expect(lastGreeksProps).toEqual({
      alpha: 0.12,
      beta: 0.4,
      correlation: 0.5,
      ir: 0.3,
      treynor: 0.2,
      reason: null,
    });
  });

  it("an omitted correlation reaches the table as null, never undefined", () => {
    renderPanel({ alpha: 0.1, beta: 0.2, ir: 0.3, treynor: 0.4 }, { kind: "computed", paired: 50, flatLeg: false });
    expect(lastGreeksProps!.correlation).toBeNull();
  });

  it("no status at all with a dash falls back to the not-computed sentence", () => {
    renderPanel(NULLS, undefined);
    expect(lastGreeksProps!.reason).toBe("Benchmark greeks are not computed for this strategy.");
  });
});

/**
 * Phase 170.5 review WR-01: the 30-day gate is for exposure and turnover. The
 * greeks are the factsheet's joint, which floors at 10 paired days, so a strategy
 * with 10-29 days of history must show on v2 what the factsheet shows.
 */
describe("ExposureAndGreeksPanel Benchmark greeks vs the 30-day gate (WR-01)", () => {
  const GATE_BODY =
    "This strategy needs at least 30 days of trading history to compute exposure and turnover.";

  it("25 days with a computed joint shows the five greek values, and the gate message names exposure only", () => {
    const { container, queryByTestId } = renderPanel(
      FULL,
      { kind: "computed", paired: 24, flatLeg: false },
      { historyDays: 25 },
    );
    expect(lastGreeksProps).toEqual({
      alpha: 0.12,
      beta: 0.4,
      correlation: 0.5,
      ir: 0.3,
      treynor: 0.2,
      reason: null,
    });
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
    // exposure keeps its own 30-day message, which no longer claims greeks cannot be computed
    expect(container.textContent).toContain("Awaiting more data");
    expect(container.textContent).toContain(GATE_BODY);
    expect(container.textContent).not.toContain("benchmark greeks.");
    expect(queryByTestId("net-gross-chart")).toBeNull();
    expect(queryByTestId("turnover-chart")).toBeNull();
  });

  it("25 days below the joint's paired floor shows the factsheet's sentence, not a 30-day claim about greeks", () => {
    const { container } = renderPanel(
      NULLS,
      { kind: "below_floor", paired: 7, floor: 10 },
      { historyDays: 25 },
    );
    expect(lastGreeksProps!.reason).toBe(
      "Alpha and beta need at least 10 days paired with BTC; this record has 7.",
    );
    expect(greeksSection(container).textContent).not.toContain("30 days");
    // exposure still has its own message
    expect(container.textContent).toContain(GATE_BODY);
  });

  it("25 days with a failed joint source still shows the greeks retry banner (the gate is not its reason)", () => {
    const { container } = renderPanel(NULLS, { kind: "error" }, { historyDays: 25 });
    expect(greeksSection(container).textContent).toContain(BANNER_HEADING);
    expect(greeksSection(container).textContent).not.toContain("30 days");
  });
});

/**
 * Phase 170.5 review WR-02: the greeks are eager server scalars. The lazy panel7
 * RPC (exposure, turnover) failing, or not having returned yet, says nothing
 * about them, and its banner must not read as a greeks failure.
 */
describe("ExposureAndGreeksPanel Benchmark greeks vs the lazy panel7 status (WR-02)", () => {
  const COMPUTED: V2JointStatus = { kind: "computed", paired: 111, flatLeg: false };

  it("lazy error with a computed joint shows the greeks, and the banner sits on the exposure part only", () => {
    const { container, queryByTestId } = renderPanel(FULL, COMPUTED, { lazyStatus: "error" });
    expect(lastGreeksProps).toEqual({
      alpha: 0.12,
      beta: 0.4,
      correlation: 0.5,
      ir: 0.3,
      treynor: 0.2,
      reason: null,
    });
    expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
    expect(greeksSection(container).textContent).not.toContain(BANNER_HEADING);
    // exactly one banner on the page: the lazy one, outside the greeks part
    expect(container.textContent?.split(BANNER_HEADING).length).toBe(2);
    expect(queryByTestId("net-gross-chart")).toBeNull();
  });

  it.each(["idle", "loading"] as const)(
    "lazy %s with a computed joint shows the greeks (nothing is loading for them)",
    (lazyStatus) => {
      const { queryByTestId } = renderPanel(FULL, COMPUTED, { lazyStatus });
      expect(queryByTestId("benchmark-greeks-table")).not.toBeNull();
      expect(lastGreeksProps!.alpha).toBe(0.12);
    },
  );

  it("a failed joint source keeps its own retry banner on the greeks part, beside a healthy lazy part", () => {
    const { container, queryByTestId } = renderPanel(NULLS, { kind: "error" }, { lazyStatus: "ready" });
    expect(greeksSection(container).textContent).toContain(BANNER_HEADING);
    expect(queryByTestId("benchmark-greeks-table")).toBeNull();
  });

  it("both failures at once are told apart: two banners, one inside the greeks part and one outside it", () => {
    const { container } = renderPanel(NULLS, { kind: "error" }, { lazyStatus: "error" });
    expect(container.textContent?.split(BANNER_HEADING).length).toBe(3);
    expect(greeksSection(container).textContent).toContain(BANNER_HEADING);
  });
});
