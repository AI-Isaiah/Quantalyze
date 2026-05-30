import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VarExpectedShortfall } from "./VarExpectedShortfall";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

describe("VarExpectedShortfall — withWidgetBoundary wiring", () => {
  it("renders the shared error card when data fails the schema", () => {
    render(<VarExpectedShortfall data={{ strategies: 123 }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders the widget for a valid composite payload", () => {
    const compositeReturns = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-02-${String((i % 27) + 1).padStart(2, "0")}`,
      value: i % 4 === 0 ? -0.03 : 0.012,
    }));
    render(
      <VarExpectedShortfall
        data={{ strategies: [], analytics: null, compositeReturns }}
        {...base}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("var-expected-shortfall")).toBeTruthy();
  });
});
