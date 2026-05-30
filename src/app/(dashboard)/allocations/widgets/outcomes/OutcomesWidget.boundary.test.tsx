import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OutcomesWidget from "./OutcomesWidget";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

// The happy path (valid populated outcomes → full table) is covered by
// outcomes.test.tsx + OutcomesWidget.v2.test.tsx, which import this same
// boundaried default export. These cases pin the boundary itself + the two
// load-bearing schema decisions: onInvalid="error" and outcomes.optional().
describe("OutcomesWidget — withWidgetBoundary wiring (onInvalid='error')", () => {
  it("non-array outcomes → error card (H-0160: was an unchecked `data as` cast)", () => {
    // Pre-B21 this flowed into computeOutcomeKPIs / outcomes.map as `any`.
    render(<OutcomesWidget data={{ outcomes: "nope" }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("row with an out-of-domain `kind` → error card", () => {
    render(
      <OutcomesWidget data={{ outcomes: [{ id: "x", kind: "weird" }] }} {...base} />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("still-loading payload (no `outcomes` key) PASSES the schema → no error card", () => {
    // outcomes.optional() is load-bearing: a loading payload must reach the
    // widget's own <LoadingState/>, NOT the boundary's error card.
    render(<OutcomesWidget data={{}} {...base} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("__error sentinel survives validation and reaches the widget's own error UI", () => {
    // __error: z.unknown().optional() + .loose() keep the sentinel; the widget's
    // own hasError branch renders (not the boundary's generic error card).
    render(<OutcomesWidget data={{ __error: true }} {...base} />);
    // Either way it must not crash; the widget's bespoke "Could not load
    // outcomes" copy is shown for the sentinel path.
    expect(screen.getByText(/could not load outcomes/i)).toBeTruthy();
  });
});
