import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TailRisk } from "./TailRisk";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

describe("TailRisk — withWidgetBoundary wiring", () => {
  it("renders the shared error card when data fails the schema (strategies not an array)", () => {
    // Runtime-malformed payload: pre-B21 this flowed into buildCompositeReturns
    // / quantile math as `any`. The boundary now rejects it before render.
    render(<TailRisk data={{ strategies: "nope" }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders the widget (no error card) for a valid composite payload", () => {
    const compositeReturns = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-01-${String((i % 27) + 1).padStart(2, "0")}`,
      value: i % 5 === 0 ? -0.05 : 0.01,
    }));
    render(
      <TailRisk
        data={{ strategies: [], analytics: null, compositeReturns }}
        {...base}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("tail-risk")).toBeTruthy();
  });
});
