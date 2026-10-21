import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CorrelationMatrix } from "./CorrelationMatrix";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

// Two ids sharing their first 8 characters: a leaked id (or id slice) shows up
// by substring and could not tell the two strategies apart.
const ID_A = "abcdef12-0000-4000-8000-000000000001";
const ID_B = "abcdef12-0000-4000-8000-000000000002";

function returns(seed: number) {
  return Array.from({ length: 12 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    value: Math.sin(i * seed) / 50,
  }));
}

describe("CorrelationMatrix — D-01 name misses", () => {
  it("precomputed path: strategies with no name read 'Unnamed strategy', never an id", () => {
    const { container } = render(
      <CorrelationMatrix
        data={{
          strategies: [{ strategy_id: ID_A }, { strategy_id: ID_B }],
          analytics: {
            correlation_matrix: {
              [ID_A]: { [ID_A]: 1, [ID_B]: 0.5 },
              [ID_B]: { [ID_A]: 0.5, [ID_B]: 1 },
            },
          },
        }}
        {...base}
      />,
    );
    expect(screen.getByTestId("correlation-matrix")).toBeTruthy();
    // zero-one-many: both unnamed strategies read the locked string (not
    // numbered) in column and row headers, titles and aria-labels.
    expect(screen.getAllByText("Unnamed strategy").length).toBeGreaterThanOrEqual(4);
    expect(container.innerHTML).not.toContain("abcdef12");
  });

  it("computed path: a strategy with no alias, codename or name reads 'Unnamed strategy', never '?' or an id", () => {
    const { container } = render(
      <CorrelationMatrix
        data={{
          strategies: [
            { strategy_id: ID_A, strategy: { strategy_analytics: { daily_returns: returns(1) } } },
            { strategy_id: ID_B, strategy: { strategy_analytics: { daily_returns: returns(2) } } },
          ],
        }}
        {...base}
      />,
    );
    expect(screen.getAllByText("Unnamed strategy").length).toBeGreaterThanOrEqual(4);
    expect(container.innerHTML).not.toContain("abcdef12");
    expect(container.querySelector('[aria-label*="Unnamed strategy and Unnamed strategy"]')).not.toBeNull();
  });

  it("a named strategy keeps its own name", () => {
    render(
      <CorrelationMatrix
        data={{
          strategies: [
            { strategy_id: ID_A, alias: "Alpha" },
            { strategy_id: ID_B },
          ],
          analytics: {
            correlation_matrix: {
              [ID_A]: { [ID_A]: 1, [ID_B]: 0.5 },
              [ID_B]: { [ID_A]: 0.5, [ID_B]: 1 },
            },
          },
        }}
        {...base}
      />,
    );
    expect(screen.getAllByText("Alpha").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Unnamed strategy").length).toBeGreaterThanOrEqual(2);
  });
});
