import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { RiskDecomposition } from "./RiskDecomposition";
import type { TimeframeKey } from "../../lib/types";

// ---------------------------------------------------------------------------
// Phase 169.4 D-75 — the risk decomposition names each key in FULL.
//
// Why this matters: the bar chart's axis used to cut every name to 12
// characters, so "Binance — Main" read "Binance — Ma" and a longer nickname on
// the same exchange could collapse into its sibling. The label now reaches the
// chart whole; the axis width is the only visual limit.
//
// ResponsiveContainer measures 0×0 in jsdom and draws nothing, so it is sized
// here (the HoldingsTabPanel.exposure test's idiom, with an explicit size).
// ---------------------------------------------------------------------------

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 400, height: 300 }),
  };
});
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

afterEach(cleanup);

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

const series = (seed: number) =>
  Array.from({ length: 30 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    value: (((i * seed) % 11) - 5) / 1000,
  }));

describe("RiskDecomposition — full key labels (D-75)", () => {
  it("two keys on one exchange: two bars, each axis label the key's full name", () => {
    const { container } = render(
      <RiskDecomposition
        data={{
          strategies: [
            {
              strategy_id: "key-aaaa-1111",
              alias: "Binance — Main",
              current_weight: 1,
              strategy: { strategy_analytics: { daily_returns: series(3) } },
            },
            {
              strategy_id: "key-bbbb-2222",
              alias: "Binance — Hedge",
              current_weight: 1,
              strategy: { strategy_analytics: { daily_returns: series(7) } },
            },
          ],
        }}
        {...base}
      />,
    );
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
    const ticks = [
      ...container.querySelectorAll(".recharts-cartesian-axis-tick-value"),
    ].map((t) => t.textContent);
    expect(ticks).toContain("Binance — Main");
    expect(ticks).toContain("Binance — Hedge");
  });
});
