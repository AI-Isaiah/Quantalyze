import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { RiskDecomposition } from "./RiskDecomposition";
import type { TimeframeKey } from "../../lib/types";

// ---------------------------------------------------------------------------
// Phase 201 / D-09, D-17 - the risk decomposition names a strategy by what its
// viewer may read: the allocator's alias, then the strategy's real name, then
// the codename. The My allocation payload nulls `name` upstream for a strategy
// the viewer cannot see (`redactedName` in `queries.ts`), so a null name here
// IS the redaction and the codename is the right label for it.
//
// ResponsiveContainer measures 0x0 in jsdom, so it is sized here (the idiom of
// RiskDecomposition.full-label.test.tsx).
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

function ticksFor(strategy: {
  alias?: string | null;
  strategy: { name?: string | null; codename?: string | null };
}): string[] {
  const { container } = render(
    <RiskDecomposition
      data={{
        strategies: [
          {
            strategy_id: "strat-aaaa-1111",
            alias: strategy.alias ?? null,
            current_weight: 1,
            strategy: {
              ...strategy.strategy,
              strategy_analytics: { daily_returns: series(3) },
            },
          },
        ],
      }}
      {...base}
    />,
  );
  return [
    ...container.querySelectorAll(".recharts-cartesian-axis-tick-value"),
  ].map((t) => t.textContent ?? "");
}

describe("RiskDecomposition - name before codename (D-09, D-17)", () => {
  it("a strategy the viewer can read is named, not codenamed", () => {
    const ticks = ticksFor({
      strategy: { name: "Fibonacci Ghost", codename: "Ghost-7" },
    });
    expect(ticks).toContain("Fibonacci Ghost");
    expect(ticks).not.toContain("Ghost-7");
  });

  it("a name redacted upstream (null) still reads as the codename", () => {
    const ticks = ticksFor({ strategy: { name: null, codename: "Ghost-7" } });
    expect(ticks).toContain("Ghost-7");
  });

  it("a whitespace-only name falls through to the codename", () => {
    const ticks = ticksFor({ strategy: { name: "   ", codename: "Ghost-7" } });
    expect(ticks).toContain("Ghost-7");
  });

  it("the allocator's alias wins over both", () => {
    const ticks = ticksFor({
      alias: "My Ghost Book",
      strategy: { name: "Fibonacci Ghost", codename: "Ghost-7" },
    });
    expect(ticks).toContain("My Ghost Book");
    expect(ticks).not.toContain("Fibonacci Ghost");
    expect(ticks).not.toContain("Ghost-7");
  });
});
