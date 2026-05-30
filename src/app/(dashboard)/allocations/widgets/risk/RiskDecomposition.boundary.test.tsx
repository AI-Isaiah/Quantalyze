import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskDecomposition } from "./RiskDecomposition";

// ---------------------------------------------------------------------------
// B21 — RiskDecomposition validation-boundary contract. The widget renders
// risk-contribution decomposition math over `data.strategies`; a malformed
// payload must surface the shared error card (not a NaN-poisoned chart), and a
// valid payload must render. This closes the lone gap in the per-widget
// boundary-test matrix: every other HOC-migrated widget had a dedicated
// failure-path test; a wrong-schema / wrong-onInvalid copy-paste in this
// widget's withWidgetBoundary call would otherwise escape every test.
// ---------------------------------------------------------------------------

const captureToSentry = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry }));

beforeEach(() => {
  vi.clearAllMocks();
});

const base = { timeframe: "1YTD" as const, width: 0, height: 0 };

describe("RiskDecomposition validation boundary", () => {
  it("renders the error card on a malformed payload", () => {
    render(<RiskDecomposition data={{ strategies: "nope" }} {...base} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders without error on a valid payload", () => {
    render(<RiskDecomposition data={{ strategies: [] }} {...base} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
