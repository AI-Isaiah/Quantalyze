import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AlphaBetaDecomposition from "./AlphaBetaDecomposition";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

describe("AlphaBetaDecomposition — withWidgetBoundary wiring (default export)", () => {
  it("renders the shared error card when data fails the schema", () => {
    render(<AlphaBetaDecomposition data={{ strategies: 5 }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders (insufficient-data state, not an error) for a valid empty payload", () => {
    render(<AlphaBetaDecomposition data={{ strategies: [], analytics: null }} {...base} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByText(/Insufficient data for alpha\/beta decomposition/i),
    ).toBeTruthy();
  });
});
