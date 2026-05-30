import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import EquityChartWidget from "./EquityChart";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
import { captureToSentry } from "@/lib/sentry-capture";

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

// These cases exercise the boundary's onInvalid="empty" path, which renders the
// shared WidgetState empty card WITHOUT mounting the inner EquityChart — so no
// TweaksProvider / next-navigation mocks are needed. The valid happy-path
// (which DOES mount the inner chart) is covered by EquityChart.test.tsx,
// .v2.test.tsx, and EquityChartWidget.header.test.tsx, all of which import this
// same boundaried default export and pass real { equityDailyPoints } payloads.
describe("EquityChartWidget — withWidgetBoundary wiring (onInvalid='empty')", () => {
  beforeEach(() => vi.clearAllMocks());

  it("structurally-malformed payload → warming-up empty card (not error), reports once", () => {
    // Pre-B21 this string flowed past isEquityChartWidgetData into the adapter
    // (the guard only checked Array.isArray when the key was present, but a
    // non-object equityDailyPoints like a string slipped to anchor/SVG math).
    render(<EquityChartWidget data={{ equityDailyPoints: "nope" }} {...base} />);
    expect(screen.getByText("Equity data warming up")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("malformed point element (missing value) → empty card", () => {
    // A structurally-broken point must not reach parseISO / anchor / the SVG
    // path builder (H-1226 / L-0079 intent): the schema pins {date, value}.
    // (No Sentry-count assertion here: the boundary's per-area breadcrumb dedup
    // is module-scoped and the prior test already reported the "equity-chart"
    // area, so a second non-null malformed payload is intentionally deduped.
    // The "reports once" behaviour is asserted by the first test above and by
    // widget-boundary.test.tsx.)
    render(
      <EquityChartWidget
        data={{ equityDailyPoints: [{ date: "2026-01-01" }] }}
        {...base}
      />,
    );
    expect(screen.getByText("Equity data warming up")).toBeTruthy();
  });

  it("null data (not-loaded) → empty card, NO report", () => {
    render(<EquityChartWidget data={null} {...base} />);
    expect(screen.getByText("Equity data warming up")).toBeTruthy();
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});
