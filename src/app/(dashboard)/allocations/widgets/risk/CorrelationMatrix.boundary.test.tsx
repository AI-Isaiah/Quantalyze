import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CorrelationMatrix } from "./CorrelationMatrix";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

describe("CorrelationMatrix — withWidgetBoundary wiring", () => {
  it("renders the shared error card when data fails the schema", () => {
    render(<CorrelationMatrix data={{ strategies: null }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders the precomputed matrix path for a valid payload", () => {
    // analytics.correlation_matrix is `unknown` in the schema and narrowed by
    // the widget's own typeof-object guard — a valid object still renders.
    render(
      <CorrelationMatrix
        data={{
          strategies: [
            { strategy_id: "a", alias: "Alpha" },
            { strategy_id: "b", alias: "Beta" },
          ],
          analytics: {
            correlation_matrix: { a: { a: 1, b: 0.5 }, b: { a: 0.5, b: 1 } },
          },
        }}
        {...base}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("correlation-matrix")).toBeTruthy();
  });
});
